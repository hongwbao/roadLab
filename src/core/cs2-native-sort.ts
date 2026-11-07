/** Unity.Collections NativeSortExtension control flow, including equal-key order. */
export function cs2NativeSort<T>(array: T[], compare: (a: T, b: T) => number) {
  const swap = (a: number, b: number) => {
    [array[a], array[b]] = [array[b], array[a]];
  };
  const swapIfGreater = (a: number, b: number) => {
    if (a !== b && compare(array[a], array[b]) > 0) swap(a, b);
  };
  const heapify = (i: number, count: number, lo: number) => {
    const value = array[lo + i - 1];
    while (i <= Math.trunc(count / 2)) {
      let next = 2 * i;
      if (next < count && compare(array[lo + next - 1], array[lo + next]) < 0)
        next++;
      if (compare(array[lo + next - 1], value) < 0) break;
      array[lo + i - 1] = array[lo + next - 1];
      i = next;
    }
    array[lo + i - 1] = value;
  };
  const sort = (lo: number, hi: number, depth: number) => {
    while (hi > lo) {
      const count = hi - lo + 1;
      if (count <= 16) {
        if (count === 2) swapIfGreater(lo, hi);
        else if (count === 3) {
          swapIfGreater(lo, hi - 1);
          swapIfGreater(lo, hi);
          swapIfGreater(hi - 1, hi);
        } else {
          for (let i = lo; i < hi; i++) {
            let previous = i;
            const value = array[i + 1];
            while (previous >= lo && compare(value, array[previous]) < 0) {
              array[previous + 1] = array[previous];
              previous--;
            }
            array[previous + 1] = value;
          }
        }
        break;
      }
      if (depth === 0) {
        for (let i = Math.trunc(count / 2); i >= 1; i--) heapify(i, count, lo);
        for (let i = count; i > 1; i--) {
          swap(lo, lo + i - 1);
          heapify(1, i - 1, lo);
        }
        break;
      }
      depth--;
      const middle = lo + Math.trunc((hi - lo) / 2);
      swapIfGreater(lo, middle);
      swapIfGreater(lo, hi);
      swapIfGreater(middle, hi);
      const pivot = array[middle];
      swap(middle, hi - 1);
      let left = lo;
      let right = hi - 1;
      while (left < right) {
        while (left < hi) {
          left++;
          if (compare(pivot, array[left]) <= 0) break;
        }
        while (right > left) {
          right--;
          if (compare(pivot, array[right]) >= 0) break;
        }
        if (left >= right) break;
        swap(left, right);
      }
      swap(left, hi - 1);
      sort(left + 1, hi, depth);
      hi = left - 1;
    }
  };
  sort(0, array.length - 1, 2 * (31 - Math.clz32(array.length)));
}
