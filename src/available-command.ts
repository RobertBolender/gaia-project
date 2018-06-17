import { Command, Faction, Building } from './enums';
import Engine from './engine';
import * as _ from 'lodash';
import factions from './factions';
import * as assert from "assert";
import { upgradedBuildings } from './buildings';

const ISOLATED_DISTANCE = 3;

export default interface AvailableCommand {
  name: Command;
  data?: any;
  player?: number;
}

export function generate(engine: Engine): AvailableCommand[] {
  // init game
  if (engine.round == -2) {
    return [{ name: Command.Init }];
  }
  // faction selection
  if (engine.round == -1 ) {
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
  }

  // initial buuildings
  if (engine.round == 0) {
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
  }

  // We are in a regular round
  const commands = [];
  const player = engine.currentPlayer;

  assert(player !== undefined, "Problem with the engine, player to play is unknown");

  const data = engine.player(player).data;
  const board = engine.player(player).board;
  const grid = engine.map.grid;

  // Add building moves
  {
    const planet = engine.player(player).planet;
    const buildings = [];

    for (const hex of engine.map.toJSON()) {
      // Not a planet or Existing building belongs to another player
      if (hex.data.planet !== planet || (hex.data.player !== undefined && hex.data.player !== player)) {
        continue;
      }

      if (hex.data.building) {
        const isolated = (() => {
          // We only care about mines that can transform into trading stations;
          if(hex.data.building !== Building.Mine) {
            return true;
          }

          // Check each other player to see if there's a building in range
          for (const pl of engine.players) {
            if (pl !== engine.player(player)) {
              for (const loc of pl.data.occupied) {
                if (grid.distance(loc.q, loc.r, hex.q, hex.r) < ISOLATED_DISTANCE) {
                  return false;
                }
              }
            }
          }

          return true;
        })();

        const upgraded = upgradedBuildings(hex.data.building, engine.player(player).faction);

        for (const upgrade of upgraded) {
          if (!engine.player(player).canBuild(upgrade, isolated)) {
            continue;
          }

          buildings.push({
            upgradedBuilding: hex.data.building,
            building: upgrade,
            cost: board.cost(upgrade, isolated).map(c => c.toString()).join(','),
            coordinates: hex.toString()
          });
        }
      } else {
        // The planet is empty, we can build a mine

        if (!engine.player(player).canBuild(Building.Mine)) {
          continue;
        }

        // Check if the range is enough to access the planet
        const inRange = data.occupied.some(loc => grid.distance(hex.q, hex.r, loc.q, loc.r) <= data.range);

        if (!inRange) {
          continue;
        }

        buildings.push({
          building: Building.Mine,
          coordinates: hex.toString(),
          cost: board.cost(Building.Mine).map(c => c.toString()).join(',')
        });
      }
    } //end for hex

    commands.push({
      name: Command.Build,
      player,
      data: { buildings }
    });
  } // end add buildings

  // Give the player the ability to pass
  commands.push({
    name: Command.Pass,
    player
  });

  return commands;
}
