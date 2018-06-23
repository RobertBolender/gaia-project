export enum Planet {
  Empty = "e",
  Terra = "r",
  Desert = "d",
  Swamp = "s",
  Oxide = "o",
  Volcanic = "v",
  Titanium = "t",
  Ice = "i",
  Gaia = "g",
  Transdim = "m"
}

export enum ResearchField {
  Terraforming = "terra",
  Navigation = "nav",
  Intelligence = "int",
  GaiaProject = "gaia",
  Economy = "eco",
  Science = "sci"
}

export enum Resource {
  None = "~",
  Ore = "o",
  Credit = "c",
  Knowledge = "k",
  Qic = "q",
  ChargePower = "pw",
  MovePower = "mpw",
  GainToken = "t",
  VictoryPoint = "vp",
  TerraformStep = "d",
  RangeExtension = "r",
  GaiaFormer = "gf",
  UpgradeTerraforming = "up-terra",
  UpgradeNavigation = "up-nav",
  UpgradeIntelligence = "up-int",
  UpgradeGaiaProject = "up-gaia",
  UpgradeEconomy = "up-eco",
  UpgradeScience = "up-sci"
}

export enum Operator {
  /** One-time income */
  Once = ">",
  /** Income at the beginning of every turn */
  Income = "+",
  /** Each time condition is fulfilled, reward is gained */
  Trigger = ">>",
  /** Activate during turn once */
  Activate = "=>",
  /** On turn end for player */
  Pass = "|",
  /** reserved op for planetary institute and academies becoming 4pw structures */
  Special = "S" 
}

export enum Condition {
  None = "~",

  // common
  Mine = "m",
  TradingStation = "ts",
  ResearchLab = "lab",
  PlanetaryInstituteOrAcademy = "PA",
  Federation = "fed",
  
  // count only
  Gaia = "g",
  PlanetType = "pt",
  Sector = "s",

  // trigger only
  MineOnGaia = "mg",
  AdvanceTech = "a",
  TerraformStep = "d"
}

export enum Building {
  Mine = "m",
  TradingStation = "ts",
  ResearchLab = "lab",
  PlanetaryInstitute = "PI",
  Academy1 = "ac1",
  Academy2 = "ac2",
  GaiaFormer = "gf"
}

export enum Faction {
  Terrans = "terrans",
  Lantids = "lantids",
  Xenos = "xenos",
  Gleens = "gleens",
  Taklons = "taklons",
  Ambas = "ambas",
  HadschHallas = "hadsch-hallas",
  Ivits = "ivits",
  Geodens = "geodens",
  BalTaks = "baltaks",
  Firaks = "firaks",
  Bescods = "bescods",
  Nevlas = "nevlas",
  Itars = "itars"
}

export enum Command {
  Init = "init",
  ChooseFaction = "faction",
  ChooseRoundBooster = "booster",
  Build = "build",
  Pass = "pass",
  UpgradeResearch = "up",
  Convert = "convert",
  Leech = "leech",
  DeclineLeech = "decline",
  BurnPower = "burn"
}

export enum Player {
  Player1,
  Player2,
  Player3,
  Player4,
  Player5
}

export enum Round {
  Init = -3,
  SetupFaction=-2,
  SetupBuilding=-1,
  SetupRoundBooster=0,
  Round1=1,
  Round2=2,
  Round3=3,
  Round4=4,
  Round5=5,
  Round6=6
}

export enum Booster {
  Booster1= "booster1",
  Booster2= "booster2",
  Booster3= "booster3",
  Booster4= "booster4",
  Booster5= "booster5",
  Booster6= "booster6",
  Booster7= "booster7",
  Booster8= "booster8",
  Booster9= "booster9",
  Booster10= "booster10"
}