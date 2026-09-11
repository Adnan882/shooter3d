import type { AuthService } from "./auth";
import type { Matchmaker } from "./matchmaker";

/** Singleton handles for services injected at boot (avoids circular imports). */
export const deps: {
  auth: AuthService | null;
  matchmaker: Matchmaker | null;
} = {
  auth: null,
  matchmaker: null,
};