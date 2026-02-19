import { pruneDelegations } from "./seeder";

export function scheduleMaintenance(): void {
  const intervalMs = 1000 * 60 * 5;

  setInterval(() => {
    pruneDelegations();
  }, intervalMs);
}
