import type { Priority } from "@strada/shared";

/**
 * Priority is an ORDINAL variable, so it is encoded as a varying quantity of one thing
 * — the length of a single brass spine — rather than as three different hues.
 *
 * Three colours would encode a nominal variable and force the reader to learn a legend.
 * Length is read pre-attentively, on the first glance, as a scale.
 *
 * Specifically NOT red/amber/green: red means "invalid input" everywhere else in this
 * app, and a traffic light applied to a person labels them an error. Reusing red here
 * would also make the eye unable to tell a priority from a validation failure on a
 * screen showing both.
 */
export const SPINE_HEIGHT: Record<Priority, string> = {
  high: "100%",
  medium: "46%",
  low: "14%",
};
