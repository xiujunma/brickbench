export type IdFactory = () => string;

/**
 * Creates short unique ids for one editor session. Ids are not persisted:
 * files store bricks without ids and fresh ones are made on load.
 */
export function createIdFactory(prefix = 'b'): IdFactory {
  const session = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}${session}${counter.toString(36)}`;
  };
}
