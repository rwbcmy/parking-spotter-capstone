import { useEffect, useRef, useState } from "react";

export default function CameraFrameImage({
  alt,
  className,
  onLoad,
  refreshMs = 7000,
  srcFactory,
  srcKey = "default",
}) {
  const srcFactoryRef = useRef(srcFactory);
  const [displaySrc, setDisplaySrc] = useState(() => srcFactory());

  useEffect(() => {
    srcFactoryRef.current = srcFactory;
  }, [srcFactory]);

  useEffect(() => {
    let cancelled = false;

    const loadFreshFrame = () => {
      const nextSrc = srcFactoryRef.current();
      const preloader = new Image();
      preloader.onload = () => {
        if (!cancelled) {
          setDisplaySrc(nextSrc);
        }
      };
      preloader.src = nextSrc;
    };

    loadFreshFrame();
    const intervalId = window.setInterval(loadFreshFrame, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [refreshMs, srcKey]);

  return <img alt={alt} className={className} onLoad={onLoad} src={displaySrc} />;
}
