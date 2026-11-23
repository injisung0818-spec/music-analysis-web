const WIDTH: usize = 31;
const RADIUS: usize = WIDTH / 2;

fn reflect(index: isize, len: usize) -> usize {
    let len = len as isize;
    let wrapped = index.rem_euclid(2 * len);
    wrapped.min(2 * len - 1 - wrapped) as usize
}

fn median_row(input: &[f32], output: &mut [f32]) {
    let len = input.len();
    let mut window: [f32; WIDTH] =
        std::array::from_fn(|i| input[reflect(i as isize - RADIUS as isize, len)]);
    window.sort_unstable_by(f32::total_cmp);
    output[0] = window[RADIUS];

    for (center, out) in output.iter_mut().enumerate().skip(1) {
        // Reflect across both ends, repeating each edge sample once per turn.
        let outgoing = center as isize - RADIUS as isize - 1;
        let incoming = center + RADIUS;
        let old = input[if outgoing >= 0 {
            outgoing as usize
        } else {
            reflect(outgoing, len)
        }];
        let new = input[if incoming < len {
            incoming
        } else {
            reflect(incoming as isize, len)
        }];

        // Keep the other 30 samples sorted as the window advances.
        if new != old {
            let remove = window.partition_point(|&value| value < old);
            let insert = window.partition_point(|&value| value < new);
            if insert > remove {
                window.copy_within(remove + 1..insert, remove);
                window[insert - 1] = new;
            } else {
                window.copy_within(insert..remove, insert + 1);
                window[insert] = new;
            }
        }
        *out = window[RADIUS];
    }
}

/// Apply a 31-sample reflect-mode median filter to each contiguous row.
///
/// # Safety
/// Both pointers must address non-overlapping, aligned buffers of
/// `rows * columns` floats. Dimensions must be nonzero and samples must
/// be finite, nonnegative magnitudes.
#[no_mangle]
pub unsafe extern "C" fn median_filter_31(
    input: *const f32,
    output: *mut f32,
    rows: usize,
    columns: usize,
) {
    let len = rows * columns;
    let input = std::slice::from_raw_parts(input, len);
    let output = std::slice::from_raw_parts_mut(output, len);
    for (input, output) in input.chunks_exact(columns).zip(output.chunks_exact_mut(columns)) {
        median_row(input, output);
    }
}

#[cfg(test)]
mod tests {
    use super::{median_row, RADIUS};

    #[test]
    fn matches_independent_window_sorts_with_reflection_and_duplicates() {
        let input: Vec<f32> = (0..73).map(|i| ((i * i + 7 * i) % 23) as f32).collect();
        let mut actual = vec![0.0; input.len()];
        median_row(&input, &mut actual);

        let padding: Vec<f32> = input[..RADIUS]
            .iter()
            .rev()
            .chain(&input)
            .chain(input[input.len() - RADIUS..].iter().rev())
            .copied()
            .collect();
        let expected: Vec<f32> = padding
            .windows(2 * RADIUS + 1)
            .map(|window| {
                let mut sorted = window.to_vec();
                sorted.sort_unstable_by(f32::total_cmp);
                sorted[RADIUS]
            })
            .collect();
        assert_eq!(actual, expected);
    }
}
