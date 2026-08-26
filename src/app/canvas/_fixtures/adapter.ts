import { relocationMission } from "./relocation";
import type { MissionFixtureAdapter } from "./types";

class RepresentativeMissionAdapter implements MissionFixtureAdapter {
  async getMission(identifier: "relocation-demo") {
    return identifier === "relocation-demo" ? relocationMission : null;
  }

  async getRelocationMission() {
    const mission = await this.getMission("relocation-demo");
    if (!mission) {
      throw new Error("The representative relocation fixture is unavailable");
    }
    return mission;
  }
}

export const missionFixtureAdapter: MissionFixtureAdapter =
  new RepresentativeMissionAdapter();
