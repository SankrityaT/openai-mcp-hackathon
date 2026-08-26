import type { JourneyStage } from "./_fixtures/types";
import { missionFixtureAdapter } from "./_fixtures/adapter";
import { CardeaCanvas } from "./_components/cardea-canvas";

const stages: JourneyStage[] = [
  "empty",
  "planning",
  "active",
  "error",
  "approval",
  "memory",
  "complete",
];

export default async function CanvasPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; theme?: string; view?: string }>;
}) {
  const { state, theme, view } = await searchParams;
  const initialStage = stages.includes(state as JourneyStage)
    ? (state as JourneyStage)
    : "empty";
  const mission = await missionFixtureAdapter.getRelocationMission();

  return (
    <CardeaCanvas
      mission={mission}
      initialStage={initialStage}
      initialTakeover={view === "takeover" ? "lyra" : null}
      initialMobileView={view === "activity" ? "activity" : undefined}
      initialTheme={theme === "light" ? "light" : theme === "dark" ? "dark" : "auto"}
    />
  );
}
