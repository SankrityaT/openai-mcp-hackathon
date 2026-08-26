export type JourneyStage =
  | "empty"
  | "planning"
  | "active"
  | "error"
  | "approval"
  | "memory"
  | "complete";

export type NodeStatus =
  | "active"
  | "paused"
  | "needs-you"
  | "error"
  | "complete";

export type MissionNode = {
  id: string;
  codename: string;
  role: string;
  task: string;
  progress: number;
  status: NodeStatus;
  commentary: string;
  previewTitle: string;
  previewDetail: string;
  x: number;
  y: number;
};

export type WalletCard = {
  id: string;
  name: string;
  detail: string;
  accent: "blue" | "coral" | "ink" | "sage";
  symbol: string;
};

export type ActivityKind =
  | "Plan"
  | "Actions"
  | "Evidence"
  | "Decisions"
  | "Errors"
  | "Approvals";

export type ActivityItem = {
  id: string;
  time: string;
  kind: ActivityKind;
  title: string;
  detail: string;
};

export type MemoryNote = {
  id: string;
  text: string;
  source: string;
  influence: string;
};

export type RelocationMissionFixture = {
  disclosure: string;
  prompt: string;
  mandate: {
    goal: string;
    constraints: string[];
    branches: string[];
    approvalBoundary: string;
  };
  wallet: WalletCard[];
  nodes: MissionNode[];
  activity: ActivityItem[];
  memories: MemoryNote[];
};

export interface MissionFixtureAdapter {
  getRelocationMission(): Promise<RelocationMissionFixture>;
}
