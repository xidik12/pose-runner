// All tunable game constants in physical units (meters, seconds).
// Tweak in playtests, never in code.

export const LANE_WIDTH        = 1.6;     // m between lane centers
export const PLAYER_EYE_Y      = 1.6;     // m camera height standing
export const PLAYER_DUCK_Y     = 1.0;     // m camera height ducking
export const PLAYER_HALF_X     = 0.4;     // m hitbox half-width
export const PLAYER_HALF_Z     = 0.4;     // m hitbox half-depth (in front/back)

export const JUMP_INITIAL_VY   = 7.0;     // m/s upward at takeoff
export const GRAVITY           = -22.0;   // m/s² (snappier than real)
export const DUCK_HOLD_MS      = 600;
export const LANE_CHANGE_MS    = 180;
export const PUNCH_REACH_M     = 1.8;     // m forward from camera
export const PUNCH_DURATION_MS = 250;
export const INVINCIBILITY_MS  = 600;     // after near-miss / damage

// Speed ramps in 5 stages over ~125s of play:
//   Stage 1 (0-25s):    8 → 9.25 m/s
//   Stage 2 (25-50s):   9.25 → 10.5
//   Stage 3 (50-75s):  10.5 → 11.75
//   Stage 4 (75-100s): 11.75 → 13.0
//   Stage 5 (100s+):   13.0 → 16.0 cap
export const SCROLL_START      = 8.0;
export const SCROLL_RAMP       = 0.50;    // m/s gained per 10s
export const SCROLL_MAX        = 16.0;

export const SPAWN_AHEAD       = 80.0;    // m in front of player
export const DESPAWN_BEHIND    = 6.0;     // m past player
export const FOG_NEAR          = 25.0;
export const FOG_FAR           = 95.0;

export const TRACK_WIDTH       = 5.4;     // m total path width
export const TRACK_SEG_LEN     = 4.0;     // m per recycled plank
export const TRACK_SEG_COUNT   = 28;      // total active segments (covers ~112m)
export const TREE_PER_SIDE_M   = 0.30;    // tree density per meter per side

export const SCORE_BATTLE_DURATION_MS = 90_000;
export const COUNTDOWN_SECONDS = 3;

export const SKY_TOP    = '#7ec0ff';
export const SKY_BOT    = '#cfe9ff';
export const FOG_COLOR  = '#9fc8e0';
export const PLANK_LIGHT = '#c8a06e';
export const PLANK_DARK  = '#a37b48';
export const RAIL_COLOR  = '#6b4a28';
export const WATER_COLOR = '#3a8aa0';

// Color tokens per obstacle kind (silhouette legibility)
export const COLOR_LOG       = '#8b5e34';
export const COLOR_DUCK_BAR  = '#cc4444';
export const COLOR_DUCK_STRIPE = '#ffd24a';
export const COLOR_WALL      = '#888888';
export const COLOR_BREAKABLE = '#a87836';
export const COLOR_FLOAT     = '#a87836';
export const COLOR_FLOAT_GLOW= '#5dd6ff';
export const COLOR_COIN      = '#ffd24a';
export const COLOR_PUNCH_HIT = '#ff8030';

export const HUD_TINT_JUMP   = 'rgba(80, 200, 255, 0.35)';
export const HUD_TINT_DUCK   = 'rgba(255, 120, 80, 0.35)';
export const HUD_TINT_LANE   = 'rgba(180, 220, 255, 0.30)';
export const HUD_TINT_PUNCH  = 'rgba(255, 200, 80, 0.40)';
export const HUD_TINT_DEATH  = 'rgba(220, 40, 40, 0.55)';
export const HUD_TINT_COIN   = 'rgba(255, 215, 80, 0.55)';
export const HUD_TINT_BREAK  = 'rgba(255, 130, 50, 0.50)';

// Lane index (0|1|2) → world X
export function laneX(lane: number): number {
  return (lane - 1) * LANE_WIDTH;
}
