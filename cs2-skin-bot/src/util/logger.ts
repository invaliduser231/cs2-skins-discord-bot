const formatMessage = (level: string, message: string, meta?: unknown): string => {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (meta === undefined) {
    return base;
  }
  const metaString = typeof meta === 'string' ? meta : JSON.stringify(meta);
  return `${base} ${metaString}`;
};

export const logger = {
  info: (message: string, meta?: unknown) => {
    console.log(formatMessage('info', message, meta));
  },
  warn: (message: string, meta?: unknown) => {
    console.warn(formatMessage('warn', message, meta));
  },
  error: (message: string, meta?: unknown) => {
    console.error(formatMessage('error', message, meta));
  }
};

export type Logger = typeof logger;
