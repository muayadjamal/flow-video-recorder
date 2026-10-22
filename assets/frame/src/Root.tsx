import React from 'react';
import { Composition } from 'remotion';
import { Framed, FramedProps } from './Framed';

// Size and length come from the props frame.sh builds out of the timeline.
export const RemotionRoot: React.FC = () => (
  <Composition
    id="Framed"
    component={Framed}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={300}
    defaultProps={{ src: 'input.mp4', videoW: 1920, videoH: 1080, zooms: [], captions: [], urls: [], subtitles: [], durationInFrames: 300, pad: 0.06, radius: 14, accent: '#2563eb', title: '', chrome: true, background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #312e81 100%)' } as FramedProps}
    calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames, width: props.videoW, height: props.videoH })}
  />
);
