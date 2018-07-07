import { Command, Faction, Building, Planet, Round, Booster, Resource, Player, Operator, BoardAction, ResearchField } from './enums';
import Engine from './engine';
import * as _ from 'lodash';
import factions from './factions';
import * as assert from "assert";
import { upgradedBuildings } from './buildings';
import Reward from './reward';
import { boardActions, freeActions } from './actions';
import * as researchTracks from './research-tracks'


const ISOLATED_DISTANCE = 3;
const UPGRADE_RESEARCH_COST = "4k";
const QIC_RANGE_UPGRADE = 2;

export default interface AvailableCommand {
  name: Command;
  data?: any;
  player?: number;
}

export function generate(engine: Engine): AvailableCommand[] {

  switch (engine.round) {
    case Round.Init: {
      return [{ name: Command.Init }];
    };
    case Round.SetupFaction: {
      return [
        {
          name: Command.ChooseFaction,
          player: engine.currentPlayer,
          data: _.difference(
            Object.values(Faction),
            engine.players.map(pl => pl.faction),
            engine.players.map(pl => factions.opposite(pl.faction))
          )
        }
      ];
    };
    case Round.SetupBuilding: {
      const player = engine.currentPlayer;
      const planet = engine.player(player).planet;
      const buildings = [];

      for (const hex of engine.map.toJSON()) {
        if (hex.data.planet === planet && !hex.data.building) {
          buildings.push({
            building:
              engine.player(player).faction !== Faction.Ivits
                ? Building.Mine
                : Building.PlanetaryInstitute,
            coordinates: hex.toString(),
            cost: '~'
          });
        }
      }

      return [
        {
          name: Command.Build,
          player,
          data: { buildings }
        }
      ];
    };
    case Round.SetupRoundBooster: 
    default : {
      // We are in a regular round
      const commands = [];
      const player = engine.currentPlayer;

      assert(player !== undefined, "Problem with the engine, player to play is unknown");

      const data = engine.player(player).data;
      const map = engine.map;
      
      if (engine.roundSubCommands.length > 0) {
        const subCommand = engine.roundSubCommands[0];
        switch (subCommand.name) {
          case Command.Leech: {
            commands.push(subCommand);
            commands.push(
              {
                name: Command.DeclineLeech,
                player: subCommand.player,
                data: subCommand.data
              }
            );
            break;
          }
          case Command.ChooseCoverTechTile: {
            const tiles = data.techTiles.map(tl => tl.enabled);
            commands.push(
              {
                name: Command.ChooseCoverTechTile,
                player: subCommand.player,
                data: { tiles }
              }
            );
            break;
          }

          case Command.UpgradeResearch: {
            commands.push(...possibleResearchAreas(engine, player, "", subCommand.data));
            break;
          }

          case Command.PlaceLostPlanet: {
            commands.push(...possibleSpaceLostPlanet(engine, player));
            break;
          }

          case Command.EndTurn: {
            commands.push(subCommand);

            //add free actions before to end turn
            commands.push(...possibleFreeActions(engine, player));
            break;
          }

          default: commands.push(subCommand);
        }
        // remove playerPassiveCommands but not endTurn
        if ( engine.roundSubCommands[0].name !== Command.EndTurn ) {
          engine.roundSubCommands.splice(0, 1)
        }

        return commands;
      } //end subCommand

      // add boosters
      {
        const boosters = Object.values(Booster).filter(booster => engine.roundBoosters[booster]);

        commands.push(
          {
            name: engine.round === Round.SetupRoundBooster ? Command.ChooseRoundBooster : Command.Pass,
            player,
            data: { boosters }
          }
        )

        if (engine.round === Round.SetupRoundBooster) {
          return commands;
        }  
      } // end add boosters

      const buildingCommand = possibleBuildings(engine, player);
      if (buildingCommand) {
        commands.push(buildingCommand);
      }

      // Add federations
      {
        const possibleTiles = Object.keys(engine.federations).filter(key => engine.federations[key] > 0);

        if (possibleTiles.length > 0) {
          const possibleFederations = engine.player(player).availableFederations(engine.map);

          if (possibleFederations.length > 0) {
            commands.push({
              name: Command.FormFederation,
              player,
              data: {
                tiles: possibleTiles,
                federations: possibleFederations.map(fed => ({
                  planets: fed.planets,
                  satellites: fed.satellites,
                  hexes: fed.hexes.map(hex => hex.toString()).sort().join(',')
                }))
              }
            });
          }
        }
      }

      // Upgrade research
      commands.push(...possibleResearchAreas(engine, player, UPGRADE_RESEARCH_COST));
   
      // free actions
      commands.push(...possibleFreeActions(engine, player));

      // power actions 
      commands.push(...possibleBoardActions(engine, player));

      // special actions 
      commands.push(...possibleSpecialActions(engine, player));
       
      return commands;
    }
  }
}

export function possibleBuildings(engine: Engine, player: Player) {
  const map = engine.map;
  const data = engine.player(player).data;
  const planet = engine.player(player).planet;
  const buildings = [];

  for (const hex of engine.map.toJSON()) {
    // exclude empty planets and other players' planets
    if (( hex.data.planet === Planet.Empty  ) || (hex.data.player !== undefined && hex.data.player !== player)) {
      continue;
    }
    //upgrade existing player's building
    if (hex.data.building ) {

      //excluding Transdim planet until transformed into Gaia planets
      if (hex.data.planet === Planet.Transdim){
        continue
      }

      const isolated = (() => {
        // We only care about mines that can transform into trading stations;
        if(hex.data.building !== Building.Mine) {
          return true;
        }

        // Check each other player to see if there's a building in range
        for (const pl of engine.players) {
          if (pl !== engine.player(player)) {
            for (const loc of pl.data.occupied) {
              if (map.distance(loc, hex) < ISOLATED_DISTANCE) {
                return false;
              }
            }
          }
        }

        return true;
      })();

      const upgraded = upgradedBuildings(hex.data.building, engine.player(player).faction);

      for (const upgrade of upgraded) {
        const buildCost = engine.player(player).canBuild(hex.data.planet, upgrade, {isolated, existingBuilding: hex.data.building});
        if ( buildCost !== undefined) {
          buildings.push({
            building: upgrade,
            cost: buildCost.map(c => c.toString()).join(','),
            coordinates: hex.toString()
          });
        }
      }
    } else {
      // planet without building
      // Check if the range is enough to access the planet
      const distance = _.min(data.occupied.map(loc => map.distance(hex, loc)));
      const qicNeeded = Math.max(Math.ceil( (distance - data.range - data.temporaryRange) / QIC_RANGE_UPGRADE), 0);

      const building = hex.data.planet === Planet.Transdim ? Building.GaiaFormer : Building.Mine  ;
      const buildCost = engine.player(player).canBuild(hex.data.planet, building, {addedCost: [new Reward(qicNeeded, Resource.Qic)]});
      if ( buildCost !== undefined ){
          buildings.push({
            building: building,
            coordinates: hex.toString(),
            cost: buildCost.map(c => c.toString()).join(',')
        });
      }         
    } 
  } //end for hex

  if (buildings.length > 0) {
    return {
      name: Command.Build,
      player,
      data: { buildings }
    };
  }
}

export function possibleSpecialActions(engine: Engine, player: Player) {
  const commands = [];
  const specialacts = [];

  for (const event of engine.player(player).events[Operator.Activate]) {
    if (!event.activated) {
      specialacts.push(
        {
          income: event.spec.replace(/\s/g, '')
        }
      )
    }
  };

  if (specialacts.length > 0) {
    commands.push({
      name: Command.Special,
      player,
      data: { specialacts }
    });
  };
  
  return commands;
}

export function possibleBoardActions(engine: Engine, player: Player) {
  const commands = [];

  let poweracts = Object.values(BoardAction).filter(pwract => engine.boardActions[pwract] && engine.player(player).canPay(Reward.parse(boardActions[pwract].cost)));
  if (poweracts.length > 0) {
    commands.push({
      name: Command.Action,
      player,
      data: { poweracts: poweracts.map(act => ({
        name: act,
        cost: boardActions[act].cost,
        income: boardActions[act].income
      }))}
    });
  };

  return commands;

}

export function possibleFreeActions(engine: Engine, player: Player) {

  // free action - spend
  const acts = [];
  const commands = [];
  for (let i = 0; i < freeActions.length; i++) {
    if (engine.player(player).canPay(Reward.parse(freeActions[i].cost))) {
      acts.push({ 
        cost: freeActions[i].cost,
        income: freeActions[i].income  
      });
    };
  };

  if (acts.length > 0) {
    commands.push({
      name: Command.Spend,
      player,
      data: { acts }
    });
  }

  //free action - burn
  //TODO generate burn actions based on  Math.ceil( engine.player(player).data.power.area2 / 2)
  if (engine.player(player).data.power.area2 >= 2) {
    commands.push({
      name: Command.BurnPower,
      player,
      data: _.range(1, Math.floor(engine.player(player).data.power.area2 / 2) + 1)
    });
  }
  return commands;

}

export function possibleResearchAreas(engine: Engine, player: Player, cost: string, destResearchArea?: ResearchField) {
  const commands = [];
  const tracks = [];
  const data = engine.players[player].data;

  if (engine.players[player].canPay(Reward.parse(cost))) {
    for (const field of Object.values(ResearchField)) {

      // up in a specific research area
      if (destResearchArea && destResearchArea !== field) {
        continue;
      }

      //already on top
      if (data.research[field] === researchTracks.lastTile(field)) {
        continue;
      }

      // end of the track reached
      const destTile = data.research[field] + 1;

      // To go from 4 to 5, we need to flip a federation and nobody inside
      if (researchTracks.keyNeeded(field, destTile) && data.greenFederations === 0) {
        continue;
      }

      if (engine.playersInOrder().some(pl => pl.data.research[field] === researchTracks.lastTile(field))) {
        continue;
      };

      tracks.push({
        field,
        to: destTile,
        cost: cost
      });

    }
  }

  if (tracks.length > 0) {
    commands.push({
      name: Command.UpgradeResearch,
      player,
      data: { tracks }
    });
  }

  return commands;
}

export function possibleSpaceLostPlanet(engine: Engine, player: Player) {
  const commands = [];
  const data = engine.player(player).data;
  const spaces = [];

  for (const hex of engine.map.toJSON()) {
    // exclude existing planets, satellites and space stations
    if (hex.data.planet !== Planet.Empty || hex.data.federations || hex.data.building) {
      continue;
    }
    const distance = _.min(data.occupied.map(loc => engine.map.distance(hex, loc)));
    //TODO posible to extened? check rules const qicNeeded = Math.max(Math.ceil( (distance - data.range) / QIC_RANGE_UPGRADE), 0);
    if (distance > data.range) {
      continue;
    }

    spaces.push({
      building: Building.Mine,
      coordinates: hex.toString(),
    });
  }

  if (spaces.length > 0) {
    commands.push({
      name: Command.PlaceLostPlanet,
      player: player,
      data: { spaces }
    });
  }

  return commands;
}
