/** One easing set and one duration scale for the whole app. */
export const ease = {
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

export const dur = { xs: 0.15, sm: 0.25, md: 0.4, lg: 0.6 };

/**
 * Page-load choreography: headline types, cards rise, charts draw last.
 * The whole sequence fits inside the first second: the last card starts within
 * about 0.35s and chart flourishes start at 0.3s. Text and numbers are never
 * held back longer than that.
 */
export const seq = {
  headline: 0.03,
  cards: 0.04,
  cardStagger: 0.03,
  charts: 0.3,
};

export const stampSpring = { type: "spring" as const, stiffness: 520, damping: 24, mass: 0.9 };

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
