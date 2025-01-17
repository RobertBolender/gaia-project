import { expect } from "chai";
import { possibleBoardActions, remainingFactions } from "./available-command";
import Engine, { AuctionVariant } from "./engine";
import { BoardAction, Faction } from "./enums";
import Player from "./player";
import PlayerData from "./player-data";

describe("Available commands", () => {
  describe("remainingFactions", () => {
    it("should show all factions at the beginning", () => {
      const engine = new Engine();

      expect(remainingFactions(engine)).to.have.members(Object.values(Faction));
    });

    it("should show 2 less factions after one is selected", () => {
      const engine = new Engine();

      expect(remainingFactions(engine)).to.include.members([Faction.Gleens, Faction.Xenos]);

      engine.setup.push(Faction.Gleens);

      const factions = remainingFactions(engine);

      expect(factions).to.not.include(Faction.Gleens);
      expect(factions).to.not.include(Faction.Xenos);
      expect(factions).to.have.length(Object.values(Faction).length - 2);
    });

    describe("when randomFactions is enabled", () => {
      it("should give only one faction at a time", () => {
        const engine = new Engine([`init 3 12`], { randomFactions: true });

        expect(remainingFactions(engine)).to.eql([Faction.Bescods]);

        engine.setup.push(Faction.Bescods);

        expect(remainingFactions(engine)).to.eql([Faction.Gleens]);

        engine.setup.push(Faction.Gleens);

        expect(remainingFactions(engine)).to.eql([Faction.BalTaks]);
      });

      describe("when auction is enabled", () => {
        it("should offer factions from a randomly selected pool (bid-while-choosing)", () => {
          const engine = new Engine([`init 3 12`], { randomFactions: true, auction: AuctionVariant.BidWhileChoosing });
          expect(remainingFactions(engine)).to.have.members([Faction.Bescods, Faction.Gleens, Faction.BalTaks]);

          engine.setup.push(Faction.Gleens);
          expect(remainingFactions(engine)).to.have.members([Faction.Bescods, Faction.BalTaks]);

          engine.setup.push(Faction.BalTaks);
          expect(remainingFactions(engine)).to.eql([Faction.Bescods]);

          engine.setup.push(Faction.Bescods);
          expect(remainingFactions(engine)).to.eql([]);
        });

        it("should give one faction at a time (choose-bid)", () => {
          const engine = new Engine([`init 3 12`], { randomFactions: true, auction: AuctionVariant.ChooseBid });
          expect(remainingFactions(engine)).to.eql([Faction.Bescods]);

          engine.setup.push(Faction.Bescods);
          expect(remainingFactions(engine)).to.eql([Faction.Gleens]);

          engine.setup.push(Faction.Gleens);
          expect(remainingFactions(engine)).to.eql([Faction.BalTaks]);

          engine.setup.push(Faction.BalTaks);
          expect(remainingFactions(engine)).to.eql([]);
        });
      });
    });
  });

  describe("Board actions", () => {
    it("should not allow board action if all resources woould be wasted", () => {
      const actions = {};
      BoardAction.values().forEach((pos: BoardAction) => {
        actions[pos] = null;
      });

      const d = new PlayerData();
      d.knowledge = 14;
      d.power.area3 = 9;
      const player = { data: d } as Player;

      function possible() {
        return possibleBoardActions(actions, player)[0].data.poweracts.map((a) => a.name);
      }

      expect(possible()).to.include("power1");
      d.knowledge = 15;
      expect(possible()).to.not.include("power1");
    });
  });
});
