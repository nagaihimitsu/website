import { finalHitSong } from "../src/room/finalHitTrack";
import { validateFinalHitChart } from "../src/room/finalHitValidation";

const reports = Object.fromEntries((["easy", "normal", "hard"] as const).map(difficulty =>
  [difficulty, validateFinalHitChart(finalHitSong(undefined, difficulty))]));
console.log(JSON.stringify(reports, null, 2));
