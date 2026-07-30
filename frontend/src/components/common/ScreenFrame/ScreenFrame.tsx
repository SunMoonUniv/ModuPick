import { useEffect, useState, type ReactNode } from 'react';
import styles from './ScreenFrame.module.css';

type ScreenFrameProps = {
  children: ReactNode;
};

// 모든 화면(랜딩·방 만들기 등)이 공유하는 FHD 1920x1080 액자 — 창 크기에 맞춰 비율 유지한 채 통째로 축소/확대함
export function ScreenFrame({ children }: ScreenFrameProps) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const updateScale = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <div className={styles.viewport}>
      <div className={styles.screen} style={{ transform: `scale(${scale})` }}>
        <span className={styles.frame} />
        <span className={`${styles.corner} ${styles.cornerTl}`} />
        <span className={`${styles.corner} ${styles.cornerTr}`} />
        <span className={`${styles.corner} ${styles.cornerBl}`} />
        <span className={`${styles.corner} ${styles.cornerBr}`} />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
