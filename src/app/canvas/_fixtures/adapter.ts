import { relocationMission } from "./relocation";
import type { MissionFixtureAdapter } from "./types";

class RepresentativeMissionAdapter implements MissionFixtureAdapter {
  async getRelocationMission() {
    return relocationMission;
  }
}

export const missionFixtureAdapter: MissionFixtureAdapter =
  new RepresentativeMissionAdapter();
