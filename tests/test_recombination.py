import importlib.util
import sys
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[1]/'pipeline/recombination.py'
spec=importlib.util.spec_from_file_location('recombination',p)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)

def records():
    rows=[]
    for i,(a,b) in enumerate([('DA','DB'),('DB','DC'),('DC','DD'),('DX','DY')]):
        for j in range(2):
            rows.append({'pmid':f'{i}{j}','year':2000,'available_year':2000,'mesh':[[a,a,True],[b,b,False]],'abstract':'Evidence text. '*10})
    return rows

class Tests(unittest.TestCase):
    def setUp(self): self.s=m.build_snapshot(records(),2000)
    def test_future_unknown_and_duplicates(self):
        rows=records();rows += [rows[0],{'pmid':'future','year':2001,'mesh':['DA','DC']},{'pmid':'unknown','mesh':['DA','DC']}]
        s=m.build_snapshot(rows,2000)
        self.assertEqual(len(s.edges[('DA','DB')]),2);self.assertNotIn(('DA','DC'),s.edges)
    def test_conflicting_record_excluded(self):
        r=records();r.append({**r[0],'year':2001});s=m.build_snapshot(r,2000)
        self.assertEqual(len(s.edges[('DA','DB')]),1)
    def test_availability(self):
        r=records();r[0]['available_year']=2002;r[1].pop('available_year')
        s=m.build_snapshot(r,2000,True);self.assertNotIn(('DA','DB'),s.edges)
    def test_intermediate_targets_and_abc(self):
        c,_=m.enumerate_candidates(self.s,['DA'])
        targets={tuple(x['target']) for x in c}
        self.assertTrue({('DA','DC'),('DA','DD'),('DB','DD')} <= targets)
    def test_one_weak_actual_edge_is_not_absence(self):
        s=m.build_snapshot(records()+[{'pmid':'weak','year':2000,'mesh':['DA','DC']}],2000)
        c,_=m.enumerate_candidates(s,['DA']);self.assertNotIn(['DA','DC'],[x['target'] for x in c])
    def test_speculative_interior_budget(self):
        c,_=m.enumerate_candidates(self.s,['DA'],[('DB','DX')])
        hit=[x for x in c if x['path']==['DA','DB','DX','DY']]
        self.assertEqual(len(hit),1);self.assertEqual(hit[0]['speculative_edges'],[['DB','DX']])
        self.assertNotIn(['DA','DX'],[x['target'] for x in c])
        self.assertNotIn(('DB','DX'),self.s.edges)
    def test_search_bounded_deterministic(self):
        c,meta=m.enumerate_candidates(self.s,['DA'],max_states=2)
        self.assertLessEqual(meta['states'],2);self.assertTrue(meta['truncated'])
        self.assertEqual((c,meta),m.enumerate_candidates(self.s,['DA'],max_states=2))
    def test_null_reproducible_and_undefined_variance(self):
        s=m.build_snapshot(records()[:2],2000)
        a,meta=m.null_statistics(s,[('DA','DB')],samples=4)
        self.assertIsNone(a[('DA','DB')]['z']);self.assertEqual(meta['accepted_swaps'],0)
        self.assertEqual((a,meta),m.null_statistics(s,[('DA','DB')],samples=4))
    def test_gate_and_independent_roles(self):
        c,_=m.enumerate_candidates(self.s,['DA']);d=m.evidence_dossier(self.s,c[0]);seen=[]
        def invoke(role,payload):
            seen.append((role,len(payload['prior'])))
            return {'text':'Test response','citations':['00']}
        out=m.run_agents(d,invoke)
        self.assertEqual(out['status'],'completed_unvalidated');self.assertEqual(seen[:2],[('mechanism',0),('alternative',0)])
        self.assertEqual(seen[2],('skeptic',2))
    def test_invalid_citation_and_call_budget(self):
        c,_=m.enumerate_candidates(self.s,['DA']);d=m.evidence_dossier(self.s,c[0])
        self.assertEqual(m.run_agents(d,lambda *_:{'text':'x','citations':['FAKE']})['status'],'invalid_output')
        self.assertEqual(m.run_agents(d,lambda *_:{'text':'x','citations':[]},max_calls=2)['status'],'budget_exhausted')
    def test_insufficient_abstract_no_call(self):
        r=records();r[0]['abstract']='';s=m.build_snapshot(r,2000);c,_=m.enumerate_candidates(s,['DA'])
        d=m.evidence_dossier(s,next(x for x in c if x['path']==['DA','DB','DC']))
        out=m.run_agents(d,lambda *_:self.fail('No call allowed'))
        self.assertEqual(out['status'],'abstained')
    def test_portfolio_no_duplicate_target(self):
        c,_=m.enumerate_candidates(self.s,['DA']);sc=m.score_candidates(self.s,c,{})
        p=m.select_portfolio(sc+sc,k=10)
        self.assertEqual(len(p),len({tuple(x['target']) for x in p}))

if __name__=='__main__':unittest.main()
