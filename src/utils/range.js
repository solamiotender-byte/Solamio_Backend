const range = (a, b, isInclusive = false) => {
  const untilB = (i, b) => (isInclusive ? i <= b : i < b);

  return {
    map: (func) => {
      const arr = [];
      for (let i = a; untilB(i, b); i++) {
        arr.push(func(i));
      }
      return arr;
    },

    toArray: () => {
      const arr = [];
      for (let i = a; untilB(i, b); i++) {
        arr.push(i);
      }
      return arr;
    },

    forEach: (func) => {
      for (let i = a; untilB(i, b); i++) {
        func(i);
      }
    },

    forEachAsync: (func) => {
      for (let i = a; untilB(i, b); i++) {
        process.nextTick(() => func(i));
      }
    }
  };
};

export default range;
