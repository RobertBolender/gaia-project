import { difference, range } from "lodash";
import { boardActions, freeActions, freeActionsItars, freeActionsTerrans } from "./actions";
import { upgradedBuildings } from "./buildings";
import { qicForDistance } from "./cost";
import Engine, { AuctionVariant, BoardActions } from "./engine";
import {
  AdvTechTilePos,
  BoardAction,
  Booster,
  Building,
  Command,
  Expansion,
  Faction,
  Operator,
  Phase,
  Planet,
  Player,
  ResearchField,
  Resource,
  SubPhase,
  TechTilePos,
} from "./enums";
import { oppositeFaction } from "./factions";
import { GaiaHex } from "./gaia-hex";
import SpaceMap from "./map";
import PlayerObject, { BuildCheck, BuildWarning } from "./player";
import PlayerData, { resourceLimits } from "./player-data";
import * as researchTracks from "./research-tracks";
import Reward from "./reward";
import { isAdvanced } from "./tiles/techs";

const ISOLATED_DISTANCE = 3;
const UPGRADE_RESEARCH_COST = "4k";

export class Offer {
  constructor(readonly offer: string, readonly cost: string) {}
}

interface AvailableCommand {
  name: Command;
  data?: any;
  player?: number;
}

export default AvailableCommand;

export type HighlightHex = { cost?: string; warnings?: BuildWarning[] };
export type AvailableHex = HighlightHex & { coordinates: string };

export type AvailableBuilding = {
  coordinates: string;
  building: Building;
  cost: string;
  warnings?: BuildWarning[];
  upgrade?: boolean;
  downgrade?: boolean;
  steps?: number;
};

export function generate(engine: Engine, subPhase: SubPhase = null, data?: any): AvailableCommand[] {
  const player = engine.playerToMove;

  if (engine.phase === Phase.RoundMove && !subPhase) {
    subPhase = SubPhase.BeforeMove;
  }

  switch (subPhase) {
    case SubPhase.ChooseTechTile:
      return possibleTechTiles(engine, player);
    case SubPhase.CoverTechTile:
      return possibleCoverTechTiles(engine, player);
    case SubPhase.UpgradeResearch:
      return possibleResearchAreas(engine, player, "", data);
    case SubPhase.PlaceLostPlanet:
      return possibleSpaceLostPlanet(engine, player);
    case SubPhase.ChooseFederationTile:
      return possibleFederationTiles(engine, player, "pool");
    case SubPhase.RescoreFederationTile:
      return possibleFederationTiles(engine, player, "player");
    case SubPhase.BuildMine:
      return possibleMineBuildings(engine, player, false);
    case SubPhase.BuildMineOrGaiaFormer:
      return possibleMineBuildings(engine, player, true, data);
    case SubPhase.SpaceStation:
      return possibleSpaceStations(engine, player);
    case SubPhase.PISwap:
      return possiblePISwaps(engine, player);
    case SubPhase.DowngradeLab:
      return possibleLabDowngrades(engine, player);
    case SubPhase.BrainStone:
      return [{ name: Command.BrainStone, player, data }];
    case SubPhase.BeforeMove: {
      return [
        ...possibleBuildings(engine, player),
        ...possibleFederations(engine, player),
        ...possibleResearchAreas(engine, player, UPGRADE_RESEARCH_COST),
        ...possibleBoardActions(engine.boardActions, engine.player(player)),
        ...possibleSpecialActions(engine, player),
        ...possibleFreeActions(engine, player),
        ...possibleRoundBoosters(engine, player),
      ];
    }
    case SubPhase.AfterMove:
      return [...possibleFreeActions(engine, player), { name: Command.EndTurn, player }];
    default:
      break;
  }

  switch (engine.phase) {
    case Phase.SetupInit:
      return [{ name: Command.Init }];
    case Phase.SetupBoard:
      return [{ name: Command.RotateSectors, player }];
    case Phase.SetupFaction:
      return chooseFactionOrBid(engine, player);
    case Phase.SetupAuction:
      return possibleBids(engine, player);
    case Phase.SetupBuilding: {
      const planet = engine.player(player).planet;
      const buildings = [];

      for (const hex of engine.map.toJSON()) {
        if (hex.data.planet === planet && !hex.data.building) {
          buildings.push({
            building: engine.player(player).faction !== Faction.Ivits ? Building.Mine : Building.PlanetaryInstitute,
            coordinates: hex.toString(),
            cost: "~",
          });
        }
      }

      return [{ name: Command.Build, player, data: { buildings } }];
    }
    case Phase.SetupBooster:
      return possibleRoundBoosters(engine, player);
    case Phase.RoundIncome:
      return possibleIncomes(engine, player);
    case Phase.RoundGaia:
      return possibleGaiaFreeActions(engine, player);
    case Phase.RoundLeech:
      return possibleLeech(engine, player);
  }

  return [];
}

function newAvailableBuilding(
  building: Building,
  hex: GaiaHex,
  canBuild: BuildCheck,
  upgrade: boolean
): AvailableBuilding {
  return {
    building,
    coordinates: hex.toString(),
    cost: Reward.toString(canBuild.cost),
    warnings: canBuild.warnings,
    steps: canBuild.steps,
    upgrade: upgrade,
  };
}

function addPossibleNewPlanet(
  data: PlayerData,
  map: SpaceMap,
  hex: GaiaHex,
  pl: PlayerObject,
  planet: Planet,
  building: Building,
  buildings: AvailableBuilding[]
) {
  const distance = Math.min(
    ...data.occupied.filter((loc) => loc.isRangeStartingPoint(pl.player)).map((loc) => map.distance(hex, loc))
  );
  const qicNeeded = qicForDistance(distance, data);
  if (qicNeeded == null) {
    return;
  }

  const check = pl.canBuild(planet, building, {
    addedCost: [new Reward(qicNeeded, Resource.Qic)],
  });

  if (check != null) {
    switch (pl.faction) {
      case Faction.Geodens:
        if (building == Building.Mine && !pl.data.hasPlanetaryInstitute() && pl.data.isNewPlanetType(hex)) {
          check.warnings.push("geodens-build-without-PI");
        }
        break;
      case Faction.Lantids:
        if (hex.occupied() && building == Building.Mine) {
          if (
            pl.data.occupied.filter((hex) => hex.data.additionalMine !== undefined).length ==
            pl.maxBuildings(Building.Mine) - 1
          ) {
            check.warnings.push("lantids-deadlock");
          }
          if (!pl.data.hasPlanetaryInstitute()) {
            check.warnings.push("lantids-build-without-PI");
          }
        }

        break;
    }
    buildings.push(newAvailableBuilding(building, hex, check, false));
  }
}

export function possibleBuildings(engine: Engine, player: Player) {
  const map = engine.map;
  const pl = engine.player(player);
  const { data } = pl;
  const buildings: AvailableBuilding[] = [];

  for (const hex of engine.map.toJSON()) {
    // upgrade existing player's building
    if (hex.buildingOf(player)) {
      const building = hex.buildingOf(player);

      if (player !== hex.data.player) {
        // This is a secondary building, so we can't upgrade it
        continue;
      }

      // excluding Transdim planet until transformed into Gaia planets
      if (hex.data.planet === Planet.Transdim) {
        continue;
      }

      // Lost planet can't be upgraded
      if (hex.data.planet === Planet.Lost) {
        continue;
      }

      const isolated = (() => {
        // We only care about mines that can transform into trading stations;
        if (building !== Building.Mine) {
          return true;
        }

        // Check each other player to see if there's a building in range
        for (const _pl of engine.players) {
          if (_pl !== engine.player(player)) {
            for (const loc of _pl.data.occupied) {
              if (loc.hasStructure() && map.distance(loc, hex) < ISOLATED_DISTANCE) {
                return false;
              }
            }
          }
        }

        return true;
      })();

      const upgraded = upgradedBuildings(building, engine.player(player).faction);

      for (const upgrade of upgraded) {
        const check = engine
          .player(player)
          .canBuild(hex.data.planet, upgrade, { isolated, existingBuilding: building });
        if (check != null) {
          buildings.push(newAvailableBuilding(upgrade, hex, check, true));
        }
      }
    } else if (pl.canOccupy(hex)) {
      // planet without building
      // Check if the range is enough to access the planet

      // No need for terra forming if already occupied by another faction
      const planet = hex.occupied() ? pl.planet : hex.data.planet;
      const building = hex.data.planet === Planet.Transdim ? Building.GaiaFormer : Building.Mine;
      addPossibleNewPlanet(data, map, hex, pl, planet, building, buildings);
    }
  } // end for hex

  if (buildings.length > 0) {
    return [
      {
        name: Command.Build,
        player,
        data: { buildings },
      },
    ];
  }

  return [];
}

export function possibleSpaceStations(engine: Engine, player: Player) {
  const map = engine.map;
  const pl = engine.player(player);
  const { data } = pl;
  const buildings = [];

  for (const hex of map.toJSON()) {
    // We can't put a space station where we already have a satellite
    if (hex.occupied() || hex.hasPlanet() || hex.belongsToFederationOf(player)) {
      continue;
    }

    const building = Building.SpaceStation;
    addPossibleNewPlanet(data, map, hex, pl, pl.planet, building, buildings);
  }

  if (buildings.length > 0) {
    return [{ name: Command.Build, player, data: { buildings } }];
  }

  return [];
}

export function possibleMineBuildings(
  engine: Engine,
  player: Player,
  acceptGaiaFormer: boolean,
  data?: { buildings?: [{ building: Building; coordinates: string; cost: string; steps?: number }] }
) {
  if (data && data.buildings) {
    return [{ name: Command.Build, player, data }];
  }

  const commands = [];
  const [buildingCommand] = possibleBuildings(engine, player);

  if (buildingCommand) {
    buildingCommand.data.buildings = buildingCommand.data.buildings.filter((bld) => {
      // If it's a gaia-former upgradable to a mine, it doesn't count
      if (bld.upgrade) {
        return false;
      }
      if (bld.building === Building.Mine) {
        return true;
      }
      return acceptGaiaFormer && bld.building === Building.GaiaFormer;
    });

    if (buildingCommand.data.buildings.length > 0) {
      commands.push(buildingCommand);
    }
  }

  return commands;
}

export function possibleSpecialActions(engine: Engine, player: Player) {
  const commands = [];
  const specialacts = [];
  const pl = engine.player(player);

  for (const event of pl.events[Operator.Activate]) {
    if (!event.activated) {
      if (
        event.rewards[0].type === Resource.DowngradeLab &&
        (pl.data.buildings[Building.ResearchLab] === 0 ||
          pl.data.buildings[Building.TradingStation] >= pl.maxBuildings(Building.TradingStation))
      ) {
        continue;
      }
      if (event.rewards[0].type === Resource.PISwap && pl.data.buildings[Building.Mine] === 0) {
        continue;
      }
      // If the action decreases rewards, the player must have them
      if (!pl.data.canPay(Reward.negative(event.rewards.filter((rw) => rw.count < 0)))) {
        continue;
      }
      specialacts.push({
        income: event.action().rewards, // Reward.toString(event.rewards),
        spec: event.spec,
      });
    }
  }

  if (specialacts.length > 0) {
    commands.push({
      name: Command.Special,
      player,
      data: { specialacts },
    });
  }

  return commands;
}

export function possibleBoardActions(actions: BoardActions, p: PlayerObject): AvailableCommand[] {
  const commands: AvailableCommand[] = [];

  // not allowed if everything is lost - see https://github.com/boardgamers/gaia-project/issues/76
  const canGain = (reward: Reward) => {
    const type = reward.type;
    const limit = resourceLimits[type];
    return limit == null || p.data.getResources(type) < limit;
  };

  let poweracts = BoardAction.values(Expansion.All).filter(
    (pwract) =>
      actions[pwract] === null &&
      p.data.canPay(Reward.parse(boardActions[pwract].cost)) &&
      boardActions[pwract].income.some((income) => Reward.parse(income).some((reward) => canGain(reward)))
  );

  // Prevent using the rescore action if no federation token
  if (p.data.tiles.federations.length === 0) {
    poweracts = poweracts.filter((act) => act !== BoardAction.Qic2);
  }

  if (poweracts.length > 0) {
    commands.push({
      name: Command.Action,
      player: p.player,
      data: {
        poweracts: poweracts.map((act) => ({
          name: act,
          cost: boardActions[act].cost,
          income: boardActions[act].income,
        })),
      },
    });
  }

  return commands;
}

export function possibleFreeActions(engine: Engine, player: Player) {
  // free action - spend
  const pl = engine.player(player);
  const commands: AvailableCommand[] = [];

  const pool = [...freeActions];
  engine.player(player).emit("freeActionChoice", pool);

  const spendCommand = transformToSpendCommand(pool, pl);
  if (spendCommand) {
    commands.push(spendCommand);
  }

  // free action - burn
  if (pl.data.burnablePower() > 0) {
    commands.push({
      name: Command.BurnPower,
      player,
      data: range(1, pl.data.burnablePower() + 1),
    });
  }

  return commands;
}

function transformToSpendCommand(actions: { cost: string; income: string }[], player: PlayerObject) {
  const acts = [];
  for (const freeAction of actions) {
    const maxPay = player.maxPayRange(Reward.parse(freeAction.cost));
    if (maxPay > 0) {
      acts.push({
        cost: freeAction.cost,
        income: freeAction.income,
        range: maxPay > 1 ? range(1, maxPay + 1) : undefined,
      });
    }
  }

  if (acts.length > 0) {
    return { name: Command.Spend, player: player.player, data: { acts } };
  }
  return null;
}

export function possibleLabDowngrades(engine: Engine, player: Player) {
  const pl = engine.player(player);
  const spots = pl.data.occupied.filter((hex) => hex.buildingOf(player) === Building.ResearchLab);

  if (!spots) {
    return [];
  }

  return [
    {
      name: Command.Build,
      player,
      data: {
        buildings: spots.map(
          (hex) =>
            ({
              building: Building.TradingStation,
              coordinates: hex.toString(),
              cost: "~",
              downgrade: true,
            } as AvailableBuilding)
        ),
      },
    },
  ] as AvailableCommand[];
}

export function canResearchField(engine: Engine, player: PlayerObject, field: ResearchField): boolean {
  const destTile = player.data.research[field] + 1;
  if (destTile === researchTracks.lastTile(field) && engine.players.some((p) => p.data.research[field] === destTile)) {
    return false;
  }

  return player.canUpgradeResearch(field);
}

export function possibleResearchAreas(engine: Engine, player: Player, cost?: string, data?: any) {
  const commands = [];
  const tracks = [];
  const pl = engine.player(player);
  const fields = ResearchField.values(engine.expansions);

  if (pl.data.canPay(Reward.parse(cost))) {
    let avFields: ResearchField[] = fields;

    if (data) {
      if (data.bescods) {
        const minArea = Math.min(...fields.map((field) => pl.data.research[field]));
        avFields = fields.filter((field) => pl.data.research[field] === minArea);
      } else if (data.pos) {
        avFields = [data.pos];
      }
    }

    for (const field of avFields) {
      if (canResearchField(engine, pl, field)) {
        tracks.push({
          field,
          to: pl.data.research[field] + 1,
          cost,
        });
      }
    }
  }

  if (tracks.length > 0) {
    commands.push({
      name: Command.UpgradeResearch,
      player,
      data: { tracks },
    });
  }

  // decline not for main action
  if (cost !== UPGRADE_RESEARCH_COST) {
    commands.push({
      name: Command.Decline,
      player,
      data: { offers: [new Offer(Command.UpgradeResearch, null)] },
    });
  }
  return commands;
}

export function possibleSpaceLostPlanet(engine: Engine, player: Player) {
  const commands = [];
  const p = engine.player(player);
  const data = p.data;
  const spaces: AvailableHex[] = [];

  for (const hex of engine.map.toJSON()) {
    // exclude existing planets, satellites and space stations
    if (hex.data.planet !== Planet.Empty || hex.data.federations || hex.data.building) {
      continue;
    }
    const distance = Math.min(...data.occupied.map((loc) => engine.map.distance(hex, loc)));
    const qicNeeded = qicForDistance(distance, data);

    if (qicNeeded > data.qics) {
      continue;
    }

    spaces.push({
      coordinates: hex.toString(),
      cost: qicNeeded > 0 ? new Reward(qicNeeded, Resource.Qic).toString() : "~",
    });
  }

  if (spaces.length > 0) {
    commands.push({
      name: Command.PlaceLostPlanet,
      player,
      data: { spaces },
    });
  }

  return commands;
}

export function possibleRoundBoosters(engine: Engine, player: Player) {
  const commands = [];
  const boosters = engine.isLastRound
    ? []
    : Booster.values(Expansion.All).filter((booster) => engine.tiles.boosters[booster]);

  commands.push({
    name: engine.phase === Phase.SetupBooster ? Command.ChooseRoundBooster : Command.Pass,
    player,
    data: { boosters },
  });

  return commands;
}

export function possibleFederations(engine: Engine, player: Player) {
  const commands = [];
  const possibleTiles = Object.keys(engine.tiles.federations).filter((key) => engine.tiles.federations[key] > 0);

  if (possibleTiles.length > 0) {
    if (engine.options.noFedCheck) {
      commands.push({
        name: Command.FormFederation,
        player,
        data: {
          tiles: possibleTiles,
          federations: [],
        },
      });
    } else {
      const possibleFeds = engine.player(player).availableFederations(engine.map, engine.options.flexibleFederations);

      if (possibleFeds.length > 0 || engine.player(player).federationCache.custom) {
        commands.push({
          name: Command.FormFederation,
          player,
          data: {
            tiles: possibleTiles,
            federations: possibleFeds.map((fed) => ({
              ...fed,
              hexes: fed.hexes
                .map((hex) => hex.toString())
                .sort()
                .join(","),
            })),
          },
        });
      }
    }
  }

  return commands;
}

export function possibleIncomes(engine: Engine, player: Player) {
  const commands = [];
  const pl = engine.player(player);

  const s = pl.incomeSelection();

  if (s.needed) {
    commands.push({
      name: Command.ChooseIncome,
      player,
      data: s.descriptions,
    });
  }
  return commands;
}

export function possibleGaiaFreeActions(engine: Engine, player: Player) {
  const commands = [];
  const pl = engine.player(player);

  if (pl.canGaiaTerrans()) {
    commands.push(transformToSpendCommand(freeActionsTerrans, pl));
  } else if (pl.canGaiaItars()) {
    if (possibleTechTiles(engine, player).length > 0) {
      commands.push({
        name: Command.Spend,
        player,
        data: {
          acts: freeActionsItars,
        },
      });
    }

    commands.push({
      name: Command.Decline,
      player,
      data: { offers: [new Offer(Resource.TechTile, new Reward(4, Resource.GainTokenGaiaArea).toString())] },
    });
  }
  return commands;
}

export function possibleLeech(engine: Engine, player: Player) {
  const commands = [];
  const pl = engine.player(player);

  if (pl.data.leechPossible > 0) {
    const extraPower = pl.faction === Faction.Taklons && pl.data.hasPlanetaryInstitute();
    const maxLeech = pl.maxLeech();
    const offers: Offer[] = [];

    if (extraPower) {
      offers.push(...getTaklonsExtraLeechOffers(maxLeech, pl.maxLeech(true)));
    } else {
      offers.push(
        new Offer(
          `${maxLeech}${Resource.ChargePower}`,
          new Reward(Math.max(maxLeech - 1, 0), Resource.VictoryPoint).toString()
        )
      );
    }

    [Command.ChargePower, Command.Decline].map((name) =>
      commands.push({
        name,
        player,
        data: {
          // Kept for compatibility with older viewer
          offer: offers[0].offer,
          // Kept for compatibility with older viewer
          cost: offers[0].cost,
          // new format
          offers,
        },
      })
    );
  }

  return commands;
}

export function getTaklonsExtraLeechOffers(earlyLeechValue: number, lateLeechValue: number): Offer[] {
  const earlyLeech = new Offer(
    `${earlyLeechValue}${Resource.ChargePower},1t`,
    new Reward(Math.max(earlyLeechValue - 1, 0), Resource.VictoryPoint).toString()
  );
  const lateLeech = new Offer(
    `1t,${lateLeechValue}${Resource.ChargePower}`,
    new Reward(Math.max(lateLeechValue - 1, 0), Resource.VictoryPoint).toString()
  );

  return [earlyLeech, lateLeech];
}

export function possibleCoverTechTiles(engine: Engine, player: Player) {
  const commands = [];

  const tiles = engine.player(player).data.tiles.techs.filter((tl) => tl.enabled && !isAdvanced(tl.pos));
  commands.push({
    name: Command.ChooseCoverTechTile,
    player,
    data: { tiles },
  });

  return commands;
}

export function possibleFederationTiles(engine: Engine, player: Player, from: "pool" | "player") {
  const commands = [];

  const possibleTiles = Object.keys(engine.tiles.federations).filter((key) => engine.tiles.federations[key] > 0);
  const playerTiles = engine.player(player).data.tiles.federations.map((fed) => fed.tile);

  commands.push({
    name: Command.ChooseFederationTile,
    player,
    data: {
      tiles: from === "player" ? playerTiles : possibleTiles,
      // Tiles that are rescored just add the rewards, but don't take the token
      rescore: from === "player",
    },
  });

  return commands;
}

export function canTakeAdvancedTechTile(engine: Engine, data: PlayerData, tilePos: AdvTechTilePos): boolean {
  if (engine.tiles.techs[tilePos].count <= 0) {
    return false;
  }
  if (!data.hasGreenFederation()) {
    return false;
  }
  if (data.research[tilePos.slice("adv-".length)] < 4) {
    return false;
  }
  if (!data.tiles.techs.some((tech) => tech.enabled && !isAdvanced(tech.pos))) {
    return false;
  }
  return true;
}

export function possibleTechTiles(engine: Engine, player: Player) {
  const commands = [];
  const tiles = [];
  const data = engine.players[player].data;

  //  tech tiles that player doesn't already have
  for (const tilePos of TechTilePos.values(engine.expansions)) {
    if (!data.tiles.techs.find((tech) => tech.tile === engine.tiles.techs[tilePos].tile)) {
      tiles.push({
        tile: engine.tiles.techs[tilePos].tile,
        pos: tilePos,
      });
    }
  }

  // adv tech tiles where player has lev 4/5, free federation tokens,
  // and available std tech tiles to cover
  for (const tilePos of AdvTechTilePos.values(engine.expansions)) {
    if (canTakeAdvancedTechTile(engine, data, tilePos)) {
      tiles.push({
        tile: engine.tiles.techs[tilePos].tile,
        pos: tilePos,
      });
    }
  }
  if (tiles.length > 0) {
    commands.push({
      name: Command.ChooseTechTile,
      player,
      data: { tiles },
    });
  }

  return commands;
}

export function possiblePISwaps(engine: Engine, player: Player) {
  const commands = [];
  const data = engine.player(player).data;
  const buildings = [];

  for (const hex of data.occupied) {
    if (hex.buildingOf(player) === Building.Mine && hex.data.planet !== Planet.Lost) {
      buildings.push({
        building: Building.Mine,
        coordinates: hex.toString(),
      });
    }
  }

  if (buildings.length > 0) {
    commands.push({
      name: Command.PISwap,
      player,
      data: { buildings },
    });
  }

  return commands;
}

export function remainingFactions(engine: Engine) {
  if (engine.randomFactions) {
    if (engine.options.auction && engine.options.auction !== AuctionVariant.ChooseBid) {
      // In auction the player can pick from the pool of random factions
      return difference(engine.randomFactions, engine.setup);
    } else {
      // Otherwise, they are limited to one specific faction
      return engine.randomFactions.length > engine.setup.length ? [engine.randomFactions[engine.setup.length]] : [];
    }
  } else {
    // Standard
    return difference(
      Object.values(Faction),
      engine.setup.map((f) => f),
      engine.setup.map((f) => oppositeFaction(f))
    );
  }
}

function chooseFactionOrBid(engine: Engine, player: Player) {
  const chooseFaction = {
    name: Command.ChooseFaction,
    player,
    data: remainingFactions(engine),
  };
  if (engine.options.auction === AuctionVariant.BidWhileChoosing) {
    return [...possibleBids(engine, player), chooseFaction];
  }
  return [chooseFaction];
}

function possibleBids(engine: Engine, player: Player) {
  const commands = [];
  const bids = [];

  for (const faction of engine.setup) {
    const bid = engine.players.find((pl) => pl.faction == faction)
      ? engine.players.find((pl) => pl.faction == faction).data.bid
      : -1;
    bids.push({
      faction,
      bid: range(bid + 1, bid + 10),
    });
  }

  if (bids.length > 0) {
    commands.push({
      name: Command.Bid,
      player,
      data: { bids },
    });
  }

  return commands;
}
