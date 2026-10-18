// What each UFO type is for, in our words: paraphrased from the game's UFO
// analysis reports (XComStrategyGame.int, TechTypeReport 61–71), whose own
// durability and armor labels are kept. The numbers beside them in the UI come
// from data/airwar.json.

export interface UfoNote {
  durability: string
  armor: string
  about: string
}

export const UFO_NOTES: Record<number, UfoNote> = {
  4: {
    durability: 'Low',
    armor: 'None',
    about: 'Fast and fragile. Scouting, research and resource runs; within reach of early jets.',
  },
  5: {
    durability: 'Moderate',
    armor: 'Moderate',
    about:
      'A jet killer: air raids and satellite hunting. Needs armor-piercing weapons; upgraded later.',
  },
  6: {
    durability: 'High',
    armor: 'Heavy',
    about: 'Armored well beyond its size. Abductions and research.',
  },
  7: {
    durability: 'Very high',
    armor: 'Heavy',
    about: 'Slow and very tough. Resource gathering and support for major operations.',
  },
  8: {
    durability: 'Highest',
    armor: 'Very heavy',
    about: 'Never lands. Bombing, satellite hunting and air superiority: the deadliest.',
  },
  9: {
    durability: 'High',
    armor: 'Very heavy',
    about:
      'The Ethereals’ flying command post; only the strongest weapons get through. Carries the Ethereal Device.',
  },
  10: {
    durability: 'Low',
    armor: 'Light',
    about: 'Scout-sized but armored. Air raids and satellite hunting; bring penetration.',
  },
  11: {
    durability: 'Moderate',
    armor: 'Very light',
    about: 'A jack of all trades, weak in a fight. Scouting, research and resource runs.',
  },
  12: {
    durability: 'High',
    armor: 'Moderate',
    about:
      'Gathers materials and specimens for the aliens; worth stopping, and open to a concentrated attack.',
  },
  13: {
    durability: 'Very high',
    armor: 'Heavy',
    about: 'Rare. Brings shock troops ahead of terror missions, or research on XCOM.',
  },
  14: {
    durability: 'Highest',
    armor: 'Heavy',
    about: 'A Battleship hull with less firepower, sent only against high-value targets.',
  },
}
