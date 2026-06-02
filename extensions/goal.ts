import { registerPiGoals } from "../src/index.js";

export default function goalExtension(pi: unknown): void {
  registerPiGoals(pi);
}
