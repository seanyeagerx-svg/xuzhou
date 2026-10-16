import React from 'react';
import styles from './original-motion.module.css';

/** Original eight-frame Xuzhou artwork. See assets/PROVENANCE.md. */
export default function Art({ pose = 'idle' }: { pose?: string }) {
  return <span aria-hidden className={styles.art} data-pose={pose}><span className={styles.sprite} /></span>;
}
