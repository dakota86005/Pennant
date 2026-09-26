/**
 * Applies a club's palette to the page. The palette itself is derived on the server's side of the code
 * (`server/presentation/palette.ts`), which the Mac app is served too, so both clients colour a club the same way.
 */
import { derivePalette, type TeamColors, type ThemeMode } from '../server/presentation/palette';

export { derivePalette };
export type { TeamColors, ThemeMode };

export function applyTeamTheme(colors: TeamColors | null, mode: ThemeMode = 'dark'): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(derivePalette(colors, mode))) {
    root.style.setProperty(key, value);
  }
  // Tells the browser which way to render scrollbars, form controls and inputs
  root.style.setProperty('color-scheme', mode);
  root.dataset.theme = mode;
}
