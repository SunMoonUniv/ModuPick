import type { HTMLAttributes } from 'react';
import styles from './ChatBubble.module.css';

// other = 상대방 메시지(왼쪽), self = 본인 메시지(오른쪽), system = 입퇴장 알림(가운데)
type BubbleVariant = 'other' | 'self' | 'system';

type ChatBubbleProps = HTMLAttributes<HTMLDivElement> & {
  variant?: BubbleVariant;
};

export function ChatBubble({ variant = 'other', className, children, ...rest }: ChatBubbleProps) {
  return (
    <div className={[styles.bubble, styles[variant], className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}
