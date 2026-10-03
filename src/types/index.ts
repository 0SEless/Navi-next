export type { Campus, CampusMapSettings, CampusStats } from './campus';
export type { Floor, Room } from './building';
export type { User, AuthState } from './user';
export type {
  LatLng, NodeType, EdgeType, ComponentType,
  NavNode, NavEdge, Building, BuildingEntrance,
  Component, GraphSnapshot, DirEntry,
  PathResult, PathStep, ValidationResult,
  TracePath, FloorPlan, FloorInfo, MapComponent,
} from './nav-types';

export type {
  StudioTool, EditorMode, LayerType,
  RoomPreset,
  StudioViewState, LayerVisibility,
} from './studio-types';

export type { PathVertex, PathSegment, EditablePath } from './path-types';

export type {
  ParametricComponent, ParametricDefinition, PrimitiveGeometry,
  RectGeometry, PolylineGeometry, PolygonGeometry, CircleGeometry,
  ArrowGeometry, TextAnchorGeometry, ParamSpec, Constraint, Diagnostic,
} from './parametric-types';
export { StairDefinition, ElevatorDefinition, DEFINITIONS } from './parametric-types';

export type {
  HallwaySegment, StraightSegment, ArcSegment, HallwayData,
  HallwaySkeleton, HallwaySkeletonVertex, HallwaySkeletonSegment,
} from './hallway-types';
export { extractHallwayData, computeHallwayPolygon, computeHallwaySkeleton, isHallwayComponent } from './hallway-types';
