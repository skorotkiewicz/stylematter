export interface StyleMatterServerOptions {
  token?: string;
  databasePath?: string;
  port?: number;
  hostname?: string;
}

export interface StyleMatterBunServer {
  readonly server: {
    readonly url: URL;
    readonly port: number;
    stop(closeActiveConnections?: boolean): void;
  };
  close(): void;
}

export function createStyleMatterServer(options?: StyleMatterServerOptions): StyleMatterBunServer;
