/**
 * Curated jobsite-narration corpus for offline dry-runs (spec §13). Used by the MOCK
 * transcriber so the whole pipeline runs with no Deepgram, AND as the eval set for
 * tuning the synthesis prompt. Deliberately includes the cases that matter:
 *  - tentative vs done ("prepped for the pour" must NOT become "poured")
 *  - proper nouns the model must spell (Watson Island, JMA, RFI numbers)
 *  - a safety deficiency that must stay prominent
 *  - a garbled clip that must become a neutral placeholder, not a fabrication
 */
export const MOCK_TRANSCRIPTS: string[] = [
  "okay we're on level three of the north tower, drywall's hung across most of the units up here and they're taping and mudding the corridor walls today, looking pretty clean",
  "this is the slab down on P2, it's all formed up and we've got the rebar tied in, we're prepped for the pour tomorrow morning weather permitting",
  "grabbing a shot of the curtain wall mockup at the marina level, JMA still owes us the RFI response on the mullion detail before we can release the rest of the order",
  "flagging this one, there's no guardrail on the west leading edge here on four, I already told the framing foreman to get it handled before end of day, that's a real fall hazard",
  "mechanical room on the podium level, ductwork is roughed in overhead but the condensate lines still need to get run and they haven't sleeved the penetrations yet",
  "uh yeah this is the, hang on the wind is, [inaudible] sorry about that",
  "south tower elevator shaft, the rails are set and plumb, Najib's crew is supposed to start hanging the car next week once the inspection clears",
  "exterior at the amenity deck, waterproofing membrane is down and they're starting to flash the planters, want to make sure we get the third party inspection on this before they cover it",
  "level two retail, the storefront framing is up but we're still waiting on the glass, that's been sitting at like a four week lead time and it's pushing our enclosure date",
  "parking ramp pour from yesterday looks good, they stripped the forms this morning, no honeycombing that I can see, we'll get the cylinders broke at seven days",
  "roof of the north tower, the EIFS is going up on the bulkheads, coverage looks consistent but I want the EIFS sub to walk it with me tomorrow to check the mesh laps",
  "podium amenity, plumbing is topping out the risers in this chase, once they're done we can close up these walls, drywall's staged and ready",
  "concrete topping slab on three is poured and finished, it's cured enough to walk, flooring sub can start their layout Monday",
  "lobby, the stone is staged on site but install hasn't started, the mockup got approved Friday so they should mobilize this week",
];
