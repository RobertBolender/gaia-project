import { Faction, Operator, ResearchField, Planet, Building, Resource, Booster } from './enums';
import PlayerData from './player-data';
import Event from './events';
import { factionBoard, FactionBoard } from './faction-boards';
import * as _ from 'lodash';
import factions from './factions';
import Reward from './reward';
import { CubeCoordinates } from 'hexagrid';
import researchTracks from './research-tracks';
import { terraformingStepsRequired } from './planets';
import boosts from './tiles/boosters';
import { stdBuildingValue } from './buildings';

const TERRAFORMING_COST = 3;

export default class Player {
  faction: Faction = null;
  board: FactionBoard = null;
  data: PlayerData = new PlayerData();
  events: { [key in Operator]: Event[] } = {
    [Operator.Once]: [],
    [Operator.Income]: [],
    [Operator.Trigger]: [],
    [Operator.Activate]: [],
    [Operator.Pass]: [],
    [Operator.Special]: []
  };

  constructor() {
    this.data.on('upgrade-knowledge', track => this.onKnowledgeUpgraded(track));
  }

  toJSON() {
    return {
      faction: this.faction,
      data: this.data
    };
  }

  static fromData(data: any) {
    const player = new Player();

    if (data.faction) {
      player.loadFaction(data.faction);
    }

    if (data.data) {
      _.merge(player.data, data.data);
    }

    return player;
  }

  get planet(): Planet {
    return factions.planet(this.faction);
  }

  canBuild(targetPlanet: Planet, building: Building, isolated = true) : Reward[] {
    if (this.data[building] >= (building === Building.GaiaFormer ? this.data.gaiaformers : this.board.maxBuildings(building))) {
      // Too many buildings of the same kind
      return undefined;
    }
    
    //gaiaforming discount
    let addedCost = "";
    if (building === Building.GaiaFormer){
      const gaiaformingDiscount =  this.data.gaiaformers > 1  ? this.data.gaiaformers : 0;
      addedCost = `-${gaiaformingDiscount}${Resource.GainToken}`
    };
    
    //habiltability costs
    if (building === Building.Mine ){
     if ( targetPlanet === Planet.Gaia) {
        addedCost = "1q";
      } else { // Get the number of terraforming steps to pay discounting terraforming track
        const steps = terraformingStepsRequired(factions[this.faction].planet, targetPlanet); 
        addedCost = `${(TERRAFORMING_COST - this.data.terraformSteps)*steps}${Resource.Ore}`;
      }
    };

    const cost = Reward.merge([].concat( this.board.cost(targetPlanet, building, isolated), [new Reward( addedCost)]));
    return this.data.canPay(cost) ? cost : undefined;
  }

  loadFaction(faction: Faction) {
    this.faction = faction;
    this.board = factionBoard(faction);

    this.loadEvents(this.board.income);

    this.data.power.bowl1 = this.board.power.bowl1;
    this.data.power.bowl2 = this.board.power.bowl2;
  }

  loadEvents(events: Event[]) {
    for (const event of events) {
      this.loadEvent(event);
    }
  }

  loadEvent(event: Event) {
    this.events[event.operator].push(event);

    if (event.operator === Operator.Once) {
      this.data.gainRewards(event.rewards);
    }
  }

  removeEvents(events: Event[]) {
    for (const event of events) {
      this.removeEvent(event);
    }  
  }

  removeEvent(event: Event) {
    let findEvent = this.events[event.operator].findIndex(
      ev => ev.toJSON === event.toJSON
    );
    this.events[event.operator].slice(findEvent, 1);
  }
  
  onKnowledgeUpgraded(field: ResearchField) {
    const events = Event.parse(researchTracks[field][this.data.research[field]]);

    this.loadEvents(events);
  }

  build(upgradedBuilding, building: Building, cost: Reward[], location: CubeCoordinates) {
    this.data.payCosts(cost);
    this.data.occupied = _.uniqWith([].concat(this.data.occupied, location), _.isEqual)

    // Add income of the building to the list of events
    this.loadEvent(this.board[building].income[this.data[building]]);
    this.data[building] += 1;

    // remove upgraded building and the associated event
    if(upgradedBuilding) {
      this.data[upgradedBuilding] -= 1;
      this.removeEvent(this.board[upgradedBuilding].income[this.data[upgradedBuilding]]);
    }
  }

  pass(){
    this.receivePassIncome();
    // remove the old booster  
    this.removeEvents( Event.parse( boosts[this.data.roundBooster]));
    this.data.roundBooster =  undefined;
  }

  getRoundBooster(roundBooster: Booster){  
    // add the booster to the the player
    this.data.roundBooster =  roundBooster;
    this.loadEvents( Event.parse( boosts[roundBooster]));
  }

  receiveIncome() {
    for (const event of this.events[Operator.Income]) {
      this.data.gainRewards(event.rewards);
    }
  }

  receivePassIncome() {
    // this is for pass tile income (e.g. rounboosters, adv tiles)
    for (const event of this.events[Operator.Pass]) {
      this.data.gainRewards(event.rewards);
    }
  }

  gaiaPhase() {
    /* Move gaia power tokens to regular power bowls */
    // Terrans move directly to power bowl 2
    if (this.faction === Faction.Terrans) {
      this.data.power.bowl2 += this.data.power.gaia;
    } else {
      this.data.power.bowl1 += this.data.power.gaia;
    }
    this.data.power.gaia = 0;
  }

  buildingValue( building: Building, planet: Planet ){ 
    //TODO different value for MadAndroids
    //TODO value if TECH3
    return stdBuildingValue(building);
  }

  maxLeech(){ 
    //TODO min(calculate charge Power, victory points (i.e. cannot charge if cannot pay)
    return 100;
  }
}