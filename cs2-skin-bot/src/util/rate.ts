import Bottleneck from 'bottleneck';

export type LimiterOptions = {
  minTime?: number;
  maxConcurrent?: number;
};

export const createLimiter = (options: LimiterOptions): Bottleneck => {
  return new Bottleneck({
    minTime: options.minTime ?? 200,
    maxConcurrent: options.maxConcurrent ?? 5
  });
};
