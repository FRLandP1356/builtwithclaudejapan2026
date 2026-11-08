import unittest

from pipeline import build_actual


class ScaleToTotalTest(unittest.TestCase):
    def test_sums_to_the_total_with_whole_numbers(self):
        out = build_actual.scale_to_total([10, 20, 30, 40], 105)
        self.assertEqual(sum(out), 105)
        self.assertTrue(all(isinstance(x, int) for x in out))

    def test_keeps_the_proportions(self):
        self.assertEqual(build_actual.scale_to_total([1, 1, 2], 8), [2, 2, 4])

    def test_total_equal_to_sum_is_unchanged(self):
        self.assertEqual(build_actual.scale_to_total([5, 0, 7], 12), [5, 0, 7])

    def test_all_zero_vector(self):
        self.assertEqual(build_actual.scale_to_total([0, 0], 0), [0, 0])
        with self.assertRaises(ValueError):
            build_actual.scale_to_total([0, 0], 3)

    def test_negative_is_rejected(self):
        with self.assertRaises(ValueError):
            build_actual.scale_to_total([1, -1], 3)


class PackAgesTest(unittest.TestCase):
    def test_95_plus_joins_the_last_two_groups(self):
        cells = list(range(1, 22))  # 21 groups
        packed = build_actual.pack_ages(cells)
        self.assertEqual(len(packed), 20)
        self.assertEqual(packed[:19], cells[:19])
        self.assertEqual(packed[19], cells[19] + cells[20])

    def test_wrong_length(self):
        with self.assertRaises(ValueError):
            build_actual.pack_ages([1] * 20)


class NumTest(unittest.TestCase):
    def test_marks_are_zero(self):
        for text in (None, "", "-", "…", "x"):
            self.assertEqual(build_actual._num(text), 0)
        self.assertEqual(build_actual._num("64288"), 64288)
        self.assertEqual(build_actual._num("64288.0"), 64288)


if __name__ == "__main__":
    unittest.main()
