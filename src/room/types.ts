export type PaletteKey = 'ink' | 'moss' | 'wood' | 'mist';
export type ThemeMode = 'light' | 'dark';
export type BranchKey = 'project' | 'tool' | 'explore' | 'daily' | 'xiaomeng';

export type HotspotId =
  | 'shelf-project'
  | 'shelf-tool'
  | 'shelf-explore'
  | 'shelf-daily'
  | 'shelf-xiaomeng'
  | 'tv-game'
  | 'calendar-notice'
  | 'gallery-wall'
  | 'desk-about'
  | 'desk-cake'
  | 'board-tags'
  | 'scope-door';

export type FocusTarget = HotspotId | 'overview';

export interface RoomBook {
  id: string;
  kind: BranchKey;
  categoryLabel: string;
  title: string;
  summary: string;
  excerpt: string;
  headings: string[];
  date: string;
  at: string;
  href: string;
  cover?: string;
  coverColor: string;
  tags: string[];
}

export interface RoomBranch {
  key: BranchKey;
  hotspotId: HotspotId;
  label: string;
  desc: string;
  href: string;
  total: number;
  books: RoomBook[];
}

export interface RoomGame {
  id: string;
  title: string;
  summary: string;
  tag: string;
  href: string;
}

export interface RoomNotice {
  title: string;
  summary: string;
  date: string;
  at: string;
  href: string;
  pinned: boolean;
  type?: string;
}

export interface RoomGalleryItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  src: string;
  thumb: string;
  cutout?: boolean;
}

export interface RoomTag {
  tag: string;
  count: number;
  href: string;
}

export interface RoomPayload {
  branches: RoomBranch[];
  games: RoomGame[];
  notices: RoomNotice[];
  latestNoticeAt?: string;
  gallery: RoomGalleryItem[];
  tags: RoomTag[];
  profile: {
    name: string;
    bio: string;
    avatar: string;
    skills: string[];
    links: { label: string }[];
    intro: string;
  };
  site: {
    name: string;
    tagline: string;
  };
}

export interface RoomThemeConfig {
  mode: ThemeMode;
  palette: PaletteKey;
  bg: string;
  accent: string;
  accentSoft: string;
  plaster: string;
  plasterAlt: string;
  hullOuter: string;
  plinth: string;
  trim: string;
  floorBase: string;
  floorGrain: string;
  woodLight: string;
  woodMid: string;
  woodDark: string;
  rugBase: string;
  rugPattern: string;
  rugBorder: string;
  upholstery: string;
  pillow: string;
  curtain: string;
  metalBrass: string;
  metalSteel: string;
  ceramic: string;
  pinkAccent: string;
  plantLeaf: string;
  keyLightColor: string;
  keyLightIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  hemiIntensity: number;
  fillLightColor: string;
  fillLightIntensity: number;
  lampColor: string;
  lampIntensity: number;
  emissiveWarm: string;
  glassTint: string;
  glassOpacity: number;
}

export interface CameraPreset {
  pos: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface HotspotMeta {
  id: HotspotId;
  label: string;
  href: string;
  preset: CameraPreset;
}

export interface HoverPayload {
  kind: 'furniture' | 'book' | 'blackhole';
  label: string;
  color?: string;
}
