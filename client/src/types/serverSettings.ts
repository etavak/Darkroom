export type VramMode = 'auto' | 'low' | 'normal' | 'high';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type DeleteMode = 'trash' | 'permanent';

export type ServerSettings = {
  generateForever: boolean;
  defaultUpscaler: string;
  defaultUpscaleScale: number;
  detailerDefault: boolean;
  promptCleanupDedupe: boolean;
  promptCleanupNormalize: boolean;
  safeMode: boolean;
  wildcardsFolder: string;
  vramMode: VramMode;
  unloadIdleMinutes: number;
  maxQueueLength: number;
  extraModelFolders: string[];
  civitaiAutoFetch: boolean;
  deleteMode: DeleteMode;
  autoBackup: boolean;
  autoBackupKeep: number;
  logLevel: LogLevel;
  experimentalFeatures: boolean;
};

export type DiskUsageInfo = {
  imagesBytes: number;
  dbBytes: number;
  trashBytes: number;
  backupsBytes: number;
  totalBytes: number;
};

export type ServerSettingsResponse = {
  settings: ServerSettings;
  diskUsage: DiskUsageInfo;
  hints: Partial<Record<keyof ServerSettings, string>>;
};

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  generateForever: false,
  defaultUpscaler: '',
  defaultUpscaleScale: 1.5,
  detailerDefault: false,
  promptCleanupDedupe: true,
  promptCleanupNormalize: true,
  safeMode: false,
  wildcardsFolder: '',
  vramMode: 'auto',
  unloadIdleMinutes: 0,
  maxQueueLength: 20,
  extraModelFolders: [],
  civitaiAutoFetch: false,
  deleteMode: 'trash',
  autoBackup: false,
  autoBackupKeep: 5,
  logLevel: 'info',
  experimentalFeatures: false,
};
