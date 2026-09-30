/** Port of Kinoko include/Common.hh (enums and helpers shared across the engine). */

export enum Course {
    Mario_Circuit = 0,
    Moo_Moo_Meadows = 1,
    Mushroom_Gorge = 2,
    Grumble_Volcano = 3,
    Toads_Factory = 4,
    Coconut_Mall = 5,
    DK_Summit = 6,
    Wario_Gold_Mine = 7,
    Luigi_Circuit = 8,
    Daisy_Circuit = 9,
    Moonview_Highway = 10,
    Maple_Treeway = 11,
    Bowsers_Castle = 12,
    Rainbow_Road = 13,
    Dry_Dry_Ruins = 14,
    Koopa_Cape = 15,
    GCN_Peach_Beach = 16,
    GCN_Mario_Circuit = 17,
    GCN_Waluigi_Stadium = 18,
    GCN_DK_Mountain = 19,
    DS_Yoshi_Falls = 20,
    DS_Desert_Hills = 21,
    DS_Peach_Gardens = 22,
    DS_Delfino_Square = 23,
    SNES_Mario_Circuit_3 = 24,
    SNES_Ghost_Valley_2 = 25,
    N64_Mario_Raceway = 26,
    N64_Sherbet_Land = 27,
    N64_Bowsers_Castle = 28,
    N64_DKs_Jungle_Parkway = 29,
    GBA_Bowser_Castle_3 = 30,
    GBA_Shy_Guy_Beach = 31,
    Delfino_Pier = 32,
    Block_Plaza = 33,
    Chain_Chomp_Roulette = 34,
    Funky_Stadium = 35,
    Thwomp_Desert = 36,
    GCN_Cookie_Land = 37,
    DS_Twilight_House = 38,
    SNES_Battle_Course_4 = 39,
    GBA_Battle_Course_3 = 40,
    N64_Skyscraper = 41,
    Galaxy_Colosseum = 54,
    Win_Demo = 55,
    Lose_Demo = 56,
    Draw_Demo = 57,
    Ending_Demo = 58,
}

export enum Character {
    Mario = 0,
    Baby_Peach = 1,
    Waluigi = 2,
    Bowser = 3,
    Baby_Daisy = 4,
    Dry_Bones = 5,
    Baby_Mario = 6,
    Luigi = 7,
    Toad = 8,
    Donkey_Kong = 9,
    Yoshi = 10,
    Wario = 11,
    Baby_Luigi = 12,
    Toadette = 13,
    Koopa_Troopa = 14,
    Daisy = 15,
    Peach = 16,
    Birdo = 17,
    Diddy_Kong = 18,
    King_Boo = 19,
    Bowser_Jr = 20,
    Dry_Bowser = 21,
    Funky_Kong = 22,
    Rosalina = 23,
    Small_Mii_Outfit_A_Male = 24,
    Small_Mii_Outfit_A_Female = 25,
    Small_Mii_Outfit_B_Male = 26,
    Small_Mii_Outfit_B_Female = 27,
    Small_Mii_Outfit_C_Male = 28,
    Small_Mii_Outfit_C_Female = 29,
    Medium_Mii_Outfit_A_Male = 30,
    Medium_Mii_Outfit_A_Female = 31,
    Medium_Mii_Outfit_B_Male = 32,
    Medium_Mii_Outfit_B_Female = 33,
    Medium_Mii_Outfit_C_Male = 34,
    Medium_Mii_Outfit_C_Female = 35,
    Large_Mii_Outfit_A_Male = 36,
    Large_Mii_Outfit_A_Female = 37,
    Large_Mii_Outfit_B_Male = 38,
    Large_Mii_Outfit_B_Female = 39,
    Large_Mii_Outfit_C_Male = 40,
    Large_Mii_Outfit_C_Female = 41,
    Medium_Mii = 42,
    Small_Mii = 43,
    Large_Mii = 44,
    Peach_Biker_Outfit = 45,
    Daisy_Biker_Outfit = 46,
    Rosalina_Biker_Outfit = 47,
    Max = 48,
}

export enum Vehicle {
    Standard_Kart_S = 0,
    Standard_Kart_M = 1,
    Standard_Kart_L = 2,
    Baby_Booster = 3,
    Classic_Dragster = 4,
    Offroader = 5,
    Mini_Beast = 6,
    Wild_Wing = 7,
    Flame_Flyer = 8,
    Cheep_Charger = 9,
    Super_Blooper = 10,
    Piranha_Prowler = 11,
    Tiny_Titan = 12,
    Daytripper = 13,
    Jetsetter = 14,
    Blue_Falcon = 15,
    Sprinter = 16,
    Honeycoupe = 17,
    Standard_Bike_S = 18,
    Standard_Bike_M = 19,
    Standard_Bike_L = 20,
    Bullet_Bike = 21,
    Mach_Bike = 22,
    Flame_Runner = 23,
    Bit_Bike = 24,
    Sugarscoot = 25,
    Wario_Bike = 26,
    Quacker = 27,
    Zip_Zip = 28,
    Shooting_Star = 29,
    Magikruiser = 30,
    Sneakster = 31,
    Spear = 32,
    Jet_Bubble = 33,
    Dolphin_Dasher = 34,
    Phantom = 35,
    Max = 36,
}

export enum WeightClass {
    Invalid = -1,
    Light = 0,
    Medium = 1,
    Heavy = 2,
}

export const COURSE_NAMES: readonly (string | null)[] = [
    "castle_course",
    "farm_course",
    "kinoko_course",
    "volcano_course",
    "factory_course",
    "shopping_course",
    "boardcross_course",
    "truck_course",
    "beginner_course",
    "senior_course",
    "ridgehighway_course",
    "treehouse_course",
    "koopa_course",
    "rainbow_course",
    "desert_course",
    "water_course",
    "old_peach_gc",
    "old_mario_gc",
    "old_waluigi_gc",
    "old_donkey_gc",
    "old_falls_ds",
    "old_desert_ds",
    "old_garden_ds",
    "old_town_ds",
    "old_mario_sfc",
    "old_obake_sfc",
    "old_mario_64",
    "old_sherbet_64",
    "old_koopa_64",
    "old_donkey_64",
    "old_koopa_gba",
    "old_heyho_gba",
    "venice_battle",
    "block_battle",
    "casino_battle",
    "skate_battle",
    "sand_battle",
    "old_CookieLand_gc",
    "old_House_ds",
    "old_battle4_sfc",
    "old_battle3_gba",
    "old_matenro_64",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "ring_mission",
    "winningrun_demo",
    "loser_demo",
    "draw_dmeo",
    "ending_demo",
];

export const VEHICLE_NAMES: readonly string[] = [
    "sdf_kart",
    "mdf_kart",
    "ldf_kart",
    "sa_kart",
    "ma_kart",
    "la_kart",
    "sb_kart",
    "mb_kart",
    "lb_kart",
    "sc_kart",
    "mc_kart",
    "lc_kart",
    "sd_kart",
    "md_kart",
    "ld_kart",
    "se_kart",
    "me_kart",
    "le_kart",
    "sdf_bike",
    "mdf_bike",
    "ldf_bike",
    "sa_bike",
    "ma_bike",
    "la_bike",
    "sb_bike",
    "mb_bike",
    "lb_bike",
    "sc_bike",
    "mc_bike",
    "lc_bike",
    "sd_bike",
    "md_bike",
    "ld_bike",
    "se_bike",
    "me_bike",
    "le_bike",
];

function inRange(c: Character, lo: Character, hi: Character): boolean {
    return c >= lo && c <= hi;
}

export function CharacterToWeight(character: Character): WeightClass {
    const C = Character;
    if (
        character === C.Baby_Peach ||
        inRange(character, C.Baby_Daisy, C.Baby_Mario) ||
        character === C.Toad ||
        inRange(character, C.Baby_Luigi, C.Koopa_Troopa) ||
        inRange(character, C.Small_Mii_Outfit_A_Male, C.Small_Mii_Outfit_C_Female) ||
        character === C.Small_Mii
    ) {
        return WeightClass.Light;
    }
    if (
        character === C.Mario ||
        character === C.Luigi ||
        character === C.Yoshi ||
        inRange(character, C.Daisy, C.Diddy_Kong) ||
        character === C.Bowser_Jr ||
        inRange(character, C.Medium_Mii_Outfit_A_Male, C.Medium_Mii_Outfit_C_Female) ||
        character === C.Medium_Mii ||
        character === C.Peach_Biker_Outfit ||
        character === C.Daisy_Biker_Outfit
    ) {
        return WeightClass.Medium;
    }
    if (
        character === C.Waluigi ||
        character === C.Bowser ||
        character === C.Donkey_Kong ||
        character === C.Wario ||
        character === C.King_Boo ||
        inRange(character, C.Dry_Bowser, C.Rosalina) ||
        inRange(character, C.Large_Mii_Outfit_A_Male, C.Large_Mii_Outfit_C_Female) ||
        character === C.Large_Mii ||
        character === C.Rosalina_Biker_Outfit
    ) {
        return WeightClass.Heavy;
    }
    return WeightClass.Invalid;
}

export function VehicleToWeight(vehicle: Vehicle): WeightClass {
    const light = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33];
    const medium = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
    const heavy = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
    if (light.includes(vehicle)) return WeightClass.Light;
    if (medium.includes(vehicle)) return WeightClass.Medium;
    if (heavy.includes(vehicle)) return WeightClass.Heavy;
    return WeightClass.Invalid;
}
