-- SF Kart leaderboard (D1). Players are freecode accounts (their user id) under a name they pick;
-- a run is kept only while it's someone's best (bests); a rules id (src/app/run/rules.ts) is a season.

CREATE TABLE players (
    id TEXT PRIMARY KEY,                          -- freecode user id (the token's sub)
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,     -- shown on the boards
    created_at INTEGER NOT NULL,                  -- ms
    banned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE runs (
    id TEXT PRIMARY KEY,                          -- run file hash (runFile.ts runId); file in R2 at runs/<id>.sfkr
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    season TEXT NOT NULL,
    vehicle TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    frames INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX runs_player ON runs(player_id);

CREATE TABLE bests (
    season TEXT NOT NULL,
    vehicle TEXT NOT NULL,                        -- ebike | robotaxi | buggy, or * (any vehicle)
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    run_vehicle TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (season, vehicle, player_id)
);
CREATE INDEX bests_board ON bests(season, vehicle, time_ms, created_at);
