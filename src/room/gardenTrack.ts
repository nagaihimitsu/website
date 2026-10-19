/** Timing measured from the user-supplied recording; seconds are native media time.
 * The slight tempo drift is intentional. Interpolate this grid instead of
 * replacing the recording with a fixed-BPM clock or changing playbackRate.
 */
export const GARDEN_TRACK = Object.freeze({
  title: "Garden-Party Groove",
  bpm: 104.7,
  sourceDuration: 60.0065,
  duration: 56.14,
  fadeStart: 55.29,
  beats: 96,
});

/** Quarter-note anchors from multiband onset analysis (approximately 4 ms fit RMS). */
export const GARDEN_BEAT_TIMES: readonly number[] = Object.freeze([
  0.171592, 0.745979, 1.31921, 1.891858, 2.464287, 3.036474, 3.608225, 4.179467,
  4.7504, 5.321398, 5.892695, 6.464209, 7.035725, 7.607129, 8.178816, 8.751027,
  9.323986, 9.897649, 10.471719, 11.045915, 11.620158, 12.194558, 12.769175, 13.343935,
  13.918622, 14.493125, 15.06753, 15.641949, 16.21641, 16.790843, 17.365116, 17.939115,
  18.512857, 19.086455, 19.660066, 20.233843, 20.807794, 21.381838, 21.955939, 22.530087,
  23.104304, 23.678585, 24.252832, 24.826867, 25.400616, 25.974162, 26.547652, 27.121228,
  27.694913, 28.268585, 28.842108, 29.415494, 29.988852, 30.562292, 31.13584, 31.709362,
  32.282605, 32.8555, 33.428155, 34.000737, 34.573413, 35.146204, 35.718918, 36.291379,
  36.863599, 37.435628, 38.007506, 38.579252, 39.150844, 39.722298, 40.293648, 40.864845,
  41.435847, 42.006739, 42.577652, 43.148651, 43.719683, 44.290632, 44.861434, 45.43214,
  46.002883, 46.573805, 47.144914, 47.716033, 48.286993, 48.857758, 49.428369, 49.99891,
  50.569423, 51.13989, 51.710297, 52.280735, 52.851312, 53.422235, 53.993743, 54.565746,
  55.137863, 55.70992, 56.28194, 56.853967, 57.426037, 57.998066, 58.569729, 59.14084,
  59.711935,
]);

export function gardenBeatToTime(beat: number): number {
  const index = Math.max(0, Math.min(GARDEN_BEAT_TIMES.length - 2, Math.floor(beat)));
  const left = GARDEN_BEAT_TIMES[index];
  return left + (beat - index) * (GARDEN_BEAT_TIMES[index + 1] - left);
}

export function gardenTimeToBeat(seconds: number): number {
  let low = 0, high = GARDEN_BEAT_TIMES.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (GARDEN_BEAT_TIMES[middle] <= seconds) low = middle;
    else high = middle;
  }
  return low + (seconds - GARDEN_BEAT_TIMES[low]) /
    (GARDEN_BEAT_TIMES[low + 1] - GARDEN_BEAT_TIMES[low]);
}

/** High-confidence attacks extracted from two independently separated bass stems.
 * YIN periodicity >= .90, stable pitch in >= half of the window, with agreement
 * from the second stem. These approximate arrangement anchors (about ±25 ms)
 * are not a complete hand-transcribed score; ambiguous glides were omitted.
 * Keep native onset times and octaves. Do not quantize them onto the beat grid.
 */
export const GARDEN_BASS_NOTES: readonly Readonly<{ time: number; midi: number }>[] = Object.freeze([
  Object.freeze({ time: 0.317, midi: 31 }),
  Object.freeze({ time: 0.762, midi: 33 }),
  Object.freeze({ time: 0.902, midi: 36 }),
  Object.freeze({ time: 1.347, midi: 43 }),
  Object.freeze({ time: 1.607, midi: 31 }),
  Object.freeze({ time: 2.517, midi: 36 }),
  Object.freeze({ time: 10.652, midi: 31 }),
  Object.freeze({ time: 11.212, midi: 31 }),
  Object.freeze({ time: 11.627, midi: 36 }),
  Object.freeze({ time: 12.492, midi: 38 }),
  Object.freeze({ time: 12.657, midi: 39 }),
  Object.freeze({ time: 13.062, midi: 28 }),
  Object.freeze({ time: 13.637, midi: 32 }),
  Object.freeze({ time: 13.917, midi: 33 }),
  Object.freeze({ time: 14.787, midi: 32 }),
  Object.freeze({ time: 15.067, midi: 31 }),
  Object.freeze({ time: 15.372, midi: 38 }),
  Object.freeze({ time: 15.547, midi: 43 }),
  Object.freeze({ time: 15.822, midi: 36 }),
  Object.freeze({ time: 16.047, midi: 36 }),
  Object.freeze({ time: 16.217, midi: 29 }),
  Object.freeze({ time: 16.677, midi: 41 }),
  Object.freeze({ time: 17.087, midi: 41 }),
  Object.freeze({ time: 17.362, midi: 40 }),
  Object.freeze({ time: 17.807, midi: 40 }),
  Object.freeze({ time: 18.222, midi: 35 }),
  Object.freeze({ time: 18.397, midi: 33 }),
  Object.freeze({ time: 18.522, midi: 38 }),
  Object.freeze({ time: 18.832, midi: 40 }),
  Object.freeze({ time: 19.377, midi: 42 }),
  Object.freeze({ time: 19.662, midi: 43 }),
  Object.freeze({ time: 20.802, midi: 41 }),
  Object.freeze({ time: 21.277, midi: 41 }),
  Object.freeze({ time: 21.672, midi: 41 }),
  Object.freeze({ time: 21.862, midi: 43 }),
  Object.freeze({ time: 22.242, midi: 41 }),
  Object.freeze({ time: 22.712, midi: 41 }),
  Object.freeze({ time: 23.102, midi: 40 }),
  Object.freeze({ time: 23.572, midi: 40 }),
  Object.freeze({ time: 23.967, midi: 35 }),
  Object.freeze({ time: 24.147, midi: 33 }),
  Object.freeze({ time: 24.542, midi: 45 }),
  Object.freeze({ time: 25.112, midi: 40 }),
  Object.freeze({ time: 25.607, midi: 38 }),
  Object.freeze({ time: 25.862, midi: 38 }),
  Object.freeze({ time: 26.262, midi: 45 }),
  Object.freeze({ time: 26.432, midi: 32 }),
  Object.freeze({ time: 26.842, midi: 31 }),
  Object.freeze({ time: 27.137, midi: 31 }),
  Object.freeze({ time: 27.417, midi: 33 }),
  Object.freeze({ time: 27.707, midi: 36 }),
  Object.freeze({ time: 28.162, midi: 36 }),
  Object.freeze({ time: 28.557, midi: 36 }),
  Object.freeze({ time: 28.752, midi: 30 }),
  Object.freeze({ time: 28.892, midi: 31 }),
  Object.freeze({ time: 29.152, midi: 43 }),
  Object.freeze({ time: 29.592, midi: 36 }),
  Object.freeze({ time: 30.172, midi: 30 }),
  Object.freeze({ time: 30.847, midi: 41 }),
  Object.freeze({ time: 31.422, midi: 34 }),
  Object.freeze({ time: 31.997, midi: 41 }),
  Object.freeze({ time: 32.567, midi: 40 }),
  Object.freeze({ time: 32.892, midi: 35 }),
  Object.freeze({ time: 33.897, midi: 45 }),
  Object.freeze({ time: 34.297, midi: 40 }),
  Object.freeze({ time: 36.862, midi: 31 }),
  Object.freeze({ time: 37.157, midi: 31 }),
  Object.freeze({ time: 37.772, midi: 31 }),
  Object.freeze({ time: 38.002, midi: 31 }),
  Object.freeze({ time: 39.157, midi: 36 }),
  Object.freeze({ time: 40.017, midi: 38 }),
  Object.freeze({ time: 40.182, midi: 39 }),
  Object.freeze({ time: 40.352, midi: 40 }),
  Object.freeze({ time: 40.577, midi: 28 }),
  Object.freeze({ time: 41.147, midi: 32 }),
  Object.freeze({ time: 41.317, midi: 33 }),
  Object.freeze({ time: 41.617, midi: 33 }),
  Object.freeze({ time: 42.287, midi: 33 }),
  Object.freeze({ time: 42.582, midi: 31 }),
  Object.freeze({ time: 43.147, midi: 36 }),
  Object.freeze({ time: 43.727, midi: 41 }),
  Object.freeze({ time: 44.177, midi: 41 }),
  Object.freeze({ time: 44.577, midi: 41 }),
  Object.freeze({ time: 45.147, midi: 40 }),
  Object.freeze({ time: 45.722, midi: 36 }),
  Object.freeze({ time: 45.897, midi: 38 }),
  Object.freeze({ time: 46.297, midi: 40 }),
  Object.freeze({ time: 46.467, midi: 40 }),
  Object.freeze({ time: 46.752, midi: 41 }),
  Object.freeze({ time: 47.147, midi: 31 }),
  Object.freeze({ time: 47.597, midi: 38 }),
  Object.freeze({ time: 47.892, midi: 31 }),
  Object.freeze({ time: 49.142, midi: 38 }),
  Object.freeze({ time: 49.432, midi: 40 }),
  Object.freeze({ time: 49.712, midi: 28 }),
  Object.freeze({ time: 50.282, midi: 32 }),
  Object.freeze({ time: 50.457, midi: 33 }),
  Object.freeze({ time: 50.852, midi: 33 }),
  Object.freeze({ time: 51.432, midi: 33 }),
  Object.freeze({ time: 51.597, midi: 33 }),
  Object.freeze({ time: 51.797, midi: 31 }),
  Object.freeze({ time: 52.307, midi: 36 }),
  Object.freeze({ time: 52.857, midi: 41 }),
  Object.freeze({ time: 53.312, midi: 41 }),
  Object.freeze({ time: 53.707, midi: 41 }),
  Object.freeze({ time: 54.002, midi: 40 }),
  Object.freeze({ time: 54.272, midi: 40 }),
  Object.freeze({ time: 54.442, midi: 40 }),
  Object.freeze({ time: 54.857, midi: 36 }),
  Object.freeze({ time: 55.027, midi: 38 }),
]);
