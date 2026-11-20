// Equalizer presets for 10 bands: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz (dB).
// Names follow the classic Apple Music / Spotify preset list. Apple doesn't
// publish its exact curves; these are the widely shared community
// approximations of those curves.
export const EQ_PRESETS = {
  'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Acoustic': [5, 4.9, 3.95, 1.05, 2.1, 1.75, 3.5, 4.1, 3.5, 2.15],
  'Bass Booster': [5.5, 4.25, 3.5, 2.5, 1.25, 0, 0, 0, 0, 0],
  'Bass Reducer': [-5.5, -4.25, -3.5, -2.5, -1.25, 0, 0, 0, 0, 0],
  'Classical': [4.75, 3.75, 3, 2.5, -1.5, -1.5, 0, 2.25, 3.25, 3.75],
  'Dance': [3.57, 6.55, 4.99, 0, 1.92, 3.65, 5.15, 4.54, 3.59, 0],
  'Deep': [4.95, 3.55, 1.75, 1, 2.85, 2.5, 1.45, -2.15, -3.55, -4.6],
  'Electronic': [4.25, 3.8, 1.2, 0, -2.15, 2.25, 0.85, 1.25, 3.95, 4.8],
  'Hip-Hop': [5, 4.25, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3],
  'Jazz': [4, 3, 1.5, 2.25, -1.5, -1.5, 0, 1.5, 3, 3.75],
  'Latin': [4.5, 3, 0, 0, -1.5, -1.5, -1.5, 0, 3, 4.5],
  'Loudness': [6, 4, 0, 0, -2, 0, -1, -5, 5, 1],
  'Lounge': [-3, -1.5, -0.5, 1.5, 4, 2.5, 0, -1.5, 2, 1],
  'Piano': [3, 2, 0, 2.5, 3, 1.5, 3.5, 4.5, 3, 3.5],
  'Pop': [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5],
  'R&B': [2.62, 6.92, 5.65, 1.33, -2.19, -1.5, 2.32, 2.65, 3, 3.75],
  'Rock': [5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5],
  'Small Speakers': [5.5, 4.25, 3.5, 2.5, 1.25, 0, -1.25, -2.5, -3.5, -4.25],
  'Spoken Word': [-3.46, -0.47, 0, 0.69, 3.46, 4.61, 4.84, 4.28, 2.54, 0],
  'Treble Booster': [0, 0, 0, 0, 0, 1.25, 2.5, 3.5, 4.25, 5.5],
  'Treble Reducer': [0, 0, 0, 0, 0, -1.25, -2.5, -3.5, -4.25, -5.5],
  'Vocal Booster': [-1.5, -3, -3, 1.5, 3.75, 3.75, 3, 1.5, 0, -1.5],
};

// Preamp that keeps a preset's biggest boost from pushing audio into the limiter.
export function autoPreamp(gains) {
  const peak = Math.max(0, ...gains);
  return -Math.round(peak * 0.6 * 2) / 2;
}
