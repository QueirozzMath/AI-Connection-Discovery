from contextlib import closing
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"pipeline"))
import temporal_model

class TemporalLeakageTests(unittest.TestCase):
    def test_training_never_reads_holdout_or_future_features(self):
        # Exercise the actual feature extraction and estimators, instrumenting
        # the SQL snapshot boundary and outcome boundary independently.
        path=str(ROOT/"pipeline/data/indexes/map.sqlite")
        if not Path(path).exists(): self.skipTest("Import local corpus for model integration tests")
        original_snapshot=temporal_model.snapshot
        original_pairs=temporal_model.observed_pairs
        snapshots=[]; outcomes=[]
        def snapshot(db,at):
            snapshots.append(at);self.assertLessEqual(at,2012)
            return original_snapshot(db,at)
        def pairs(db,start,end):
            outcomes.append((start,end));self.assertLessEqual(end,2018)
            return original_pairs(db,start,end)
        temporal_model.train.cache_clear()
        with patch.object(temporal_model,"snapshot",side_effect=snapshot),patch.object(temporal_model,"observed_pairs",side_effect=pairs):
            trained=temporal_model.train(path,"leakage-test",2018)
        self.assertTrue(trained["available"])
        self.assertEqual(snapshots,[2012]);self.assertEqual(outcomes,[(2013,2018)])
        self.assertEqual(trained["model"]["trainedThrough"],2018)
    def test_insufficient_history_is_explicit(self):
        path=str(ROOT/"pipeline/data/indexes/map.sqlite")
        if not Path(path).exists(): self.skipTest("Import local corpus for model integration tests")
        result=temporal_model.train(path,"early-test",1990)
        self.assertFalse(result["available"])
        self.assertIn("insuficientes",result["reason"])

if __name__=="__main__":unittest.main()
