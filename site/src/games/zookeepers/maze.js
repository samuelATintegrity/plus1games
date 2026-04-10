// Zookeepers — maze definition, parser, and tile constants.
//
// The maze is a full 31×33 grid. Every row must be exactly 31 characters.
// Classic Pac-Man-inspired symmetric design with a central ghost pen.

// ---- Tile type constants -----------------------------------------------------

export const TILE = {
  EMPTY:    0,
  WALL:     1,
  DOT:      2,
  PELLET:   3,
  PEN_WALL: 4,
  PEN_GATE: 5,
  TUNNEL:   6,
};

// ---- Maze dimensions ---------------------------------------------------------

export const COLS = 31;
export const ROWS = 33;

// ---- Full maze definition (31 cols × 33 rows) -------------------------------
// Legend:  # wall  . dot  O power pellet  (space) empty  - pen gate  P pen interior
//          A animal spawn  1 zookeeper-1 spawn  2 zookeeper-2 spawn

//           0         1         2         3
//           0123456789012345678901234567890
const MAZE_ROWS = [
  '###############################', //  0
  '#.............#.............#.#', //  1
  '#.###.#######.#.#######.###.#.#', //  2
  '#O..#.#.....#.#.#.....#.#..O#.#', //  3
  '#.#.#.#.###.#.#.#.###.#.#.#.#.#', //  4
  '#.#...#.#...#.#.#...#.#...#...#', //  5
  '#.#####.#.#########.#.#####.#.#', //  6
  '#.......#.....#.....#.......#.#', //  7
  '#.#####.#####.#.#####.#####.#.#', //  8
  '#.#...........#...........#...#', //  9
  '#.#.###.##### # #####.###.#.#.#', // 10
  '#...#...#           #...#...#.#', // 11
  '#.###.#.# ###---### #.#.###.#.#', // 12 pen top with gate
  '#.#...#.# #PPPPPPP# #.#...#.#.#', // 13 pen interior
  '#.#.#.#.# #PPAAAAP# #.#.#.#.#.#', // 14 pen with 4 animal spawns
  '#.#.#.#.# #PPPPPPP# #.#.#.#.#.#', // 15 pen interior
  '#.#.#.#.# ######### #.#.#.#.#.#', // 16 pen bottom
  '#...#...#           #...#...#.#', // 17
  '#.###.#.##### # #####.#.###.#.#', // 18
  '#.#.......#...#...#.......#...#', // 19
  '#.#.#####.#.#####.#.#####.#.#.#', // 20
  '#...#.....#.......#.....#...#.#', // 21
  '#.#####.#.#########.#.#####.#.#', // 22
  '#.......#.....#.....#.........#', // 23
  '#.###.#######.#.#######.###.#.#', // 24
  '#.#1#.........#.........#2#.#.#', // 25 zookeeper spawns
  '#.#.#.#######.#.#######.#.#.#.#', // 26
  '#O..#.......#.#.#.......#..O#.#', // 27 power pellets
  '#.###.#.###.#.#.#.###.#.###.#.#', // 28
  '#.....#.#...#...#...#.#.....#.#', // 29
  '#.#####.#.#########.#.#####.#.#', // 30
  '#.............#.............#.#', // 31
  '###############################', // 32
];

// Validate row lengths in dev (stripped in production)
if (typeof process === 'undefined' || !process.env?.NODE_ENV || process.env.NODE_ENV !== 'production') {
  for (let i = 0; i < MAZE_ROWS.length; i++) {
    if (MAZE_ROWS[i].length !== COLS) {
      console.warn(`Maze row ${i} has ${MAZE_ROWS[i].length} chars, expected ${COLS}`);
    }
  }
}

// ---- Parser ------------------------------------------------------------------

export function parseMaze() {
  const tiles = new Uint8Array(COLS * ROWS);
  const spawns = { zk1: null, zk2: null, animals: [], penGate: null };
  let dotCount = 0;

  for (let row = 0; row < ROWS; row++) {
    const line = MAZE_ROWS[row] || '';
    for (let col = 0; col < COLS; col++) {
      const ch = col < line.length ? line[col] : ' ';
      const idx = row * COLS + col;

      switch (ch) {
        case '#': tiles[idx] = TILE.WALL; break;
        case '.': tiles[idx] = TILE.DOT; dotCount++; break;
        case 'O': tiles[idx] = TILE.PELLET; dotCount++; break;
        case ' ': tiles[idx] = TILE.EMPTY; break;
        case '-': tiles[idx] = TILE.PEN_GATE;
          if (!spawns.penGate) spawns.penGate = { col, row };
          break;
        case 'P': tiles[idx] = TILE.EMPTY; break;
        case 'A': tiles[idx] = TILE.EMPTY;
          spawns.animals.push({ col, row });
          break;
        case '1': tiles[idx] = TILE.EMPTY;
          spawns.zk1 = { col, row };
          break;
        case '2': tiles[idx] = TILE.EMPTY;
          spawns.zk2 = { col, row };
          break;
        default: tiles[idx] = TILE.EMPTY; break;
      }
    }
  }

  return { tiles, spawns, dotCount };
}

// ---- Helpers -----------------------------------------------------------------

export function isWalkable(tileValue) {
  return tileValue !== TILE.WALL && tileValue !== TILE.PEN_WALL;
}

export function isWalkableByAnimal(tileValue) {
  return tileValue !== TILE.WALL && tileValue !== TILE.PEN_WALL;
}

export function isWalkableByZookeeper(tileValue) {
  return tileValue !== TILE.WALL && tileValue !== TILE.PEN_WALL && tileValue !== TILE.PEN_GATE;
}

export function countDots(tiles) {
  let n = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TILE.DOT || tiles[i] === TILE.PELLET) n++;
  }
  return n;
}
