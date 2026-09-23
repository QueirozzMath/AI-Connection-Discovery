import json
from pathlib import Path
import tempfile
import unittest
from contextlib import closing

from map_store import connect, import_file
from lbd_engine import MESH_SCHEMA, candidate, concepts, discover, tree_distance


class LBDTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.path=self.root/'test.sqlite'
        self.template={'nodes':[], 'meta':{'source':'test fixture'}}
        self.add([
            ('1',2010,['A','B']),('2',2011,['B','C']),('3',2012,['A','D']),
            ('4',2013,['D','C']),('5',2015,['A','C']),('6',2016,['F','G'])])
        with closing(connect(self.path)) as db:
            db.executescript(MESH_SCHEMA)
            db.execute("UPDATE mesh SET category='X'")
            db.execute("UPDATE mesh SET category='Y' WHERE id IN ('B','D')")
            db.commit()

    def add(self, records):
        path=self.root/f'{len(list(self.root.glob("*.jsonl")))}.jsonl'
        path.write_text('\n'.join(json.dumps({'pmid':p,'year':y,'title':f'Article {p}',
            'mesh':[[mid,mid,0] for mid in ids]}) for p,y,ids in records),encoding='utf-8')
        import_file(self.path,path,{},self.template)

    def detail(self,cutoff=2014):
        with closing(connect(self.path)) as db: return candidate(db,'A','C',cutoff)

    def test_abc_multiple_bridges_with_link_specific_evidence(self):
        value=self.detail()
        self.assertTrue(value['eligible'])
        self.assertEqual(value['metrics']['pathCount'],2)
        self.assertEqual(value['metrics']['evidenceStrength'],4)
        b=next(p for p in value['paths'] if p['B']['id']=='B')
        self.assertEqual([a['pmid'] for a in b['AB']['articles']],['1'])
        self.assertEqual([a['pmid'] for a in b['BC']['articles']],['2'])
        self.assertIsNone(value['metrics']['contradictionSignal'])

    def test_open_and_closed_discovery_known_exclusion(self):
        with closing(connect(self.path)) as db:
            result=discover(db,{'startYear':2010,'endYear':2014,'mode':'open','a':'A'})
            self.assertIn('C',[r['C']['id'] for r in result['items']])
            self.assertNotIn('B',[r['C']['id'] for r in result['items']])
            closed=discover(db,{'startYear':2010,'endYear':2014,'mode':'closed','a':'A','c':'C'})
            self.assertEqual(closed['items'][0]['metrics']['pathCount'],2)
        self.assertFalse(self.detail(2015)['eligible'])

    def test_future_cannot_change_cutoff_metrics_or_evidence(self):
        before=self.detail()
        self.add([('7',2026,['A','B','C','F'])])
        after=self.detail()
        for key in ('paths','metrics','directCount','firstKnownYear'):
            self.assertEqual(before[key],after[key])
        self.assertTrue(all(a['year']<=2014 for p in after['paths'] for side in ('AB','BC') for a in p[side]['articles']))

    def test_no_path_fails_without_fabricating_evidence(self):
        with closing(connect(self.path)) as db:
            with self.assertRaisesRegex(ValueError,'Nenhum caminho'): candidate(db,'A','F',2014)

    def test_closed_discovery_respects_period_and_filters(self):
        with closing(connect(self.path)) as db:
            value=discover(db,{'startYear':2010,'endYear':2014,'mode':'closed','a':'A','c':'C','categories':['Y']})
            self.assertEqual(value['items'],[])

    def test_revision_history_and_delete_preserve_original_snapshot(self):
        self.add([('1',2026,['A','F'])])
        with closing(connect(self.path)) as db:
            row=db.execute("SELECT previous_payload,event_payload FROM article_revisions WHERE pmid='1'").fetchone()
            self.assertEqual(json.loads(row[0])['year'],2010)
            self.assertEqual(json.loads(row[1])['year'],2026)
            self.assertFalse(db.execute("SELECT 1 FROM pair_year WHERE year=2010 AND mesh_a='A' AND mesh_b='B'").fetchone())

    def test_qualifiers_and_substances_parser(self):
        import xml.etree.ElementTree as ET
        from pubmed_bulk import article_event
        xml=ET.fromstring('<PubmedArticle><MedlineCitation><PMID>1</PMID><MeshHeadingList><MeshHeading><DescriptorName UI="D1">Term</DescriptorName><QualifierName UI="Q1" MajorTopicYN="Y">therapy</QualifierName></MeshHeading></MeshHeadingList><ChemicalList><Chemical><RegistryNumber>0</RegistryNumber><NameOfSubstance UI="C1">Substance</NameOfSubstance></Chemical></ChemicalList></MedlineCitation></PubmedArticle>')
        annotations=article_event(xml)['annotations']
        self.assertEqual(annotations['qualifiers'][0]['id'],'Q1')
        self.assertTrue(annotations['qualifiers'][0]['major'])
        self.assertEqual(annotations['substances'][0]['id'],'C1')
        self.assertIsNone(annotations['meshVersion'])

    def test_current_mesh_is_not_used_as_historical_model_features(self):
        from temporal_model import historical_meta
        value=historical_meta(self.path,[{'id':'A','growth':1}],2014)
        self.assertEqual(value['trees'],{})
        self.assertEqual(value['branch'],{})

    def test_global_search_keyword_and_or_respect_period(self):
        with closing(connect(self.path)) as db:
            self.assertEqual(concepts(db,2010,2014,'F')['items'],[])
            self.assertEqual(concepts(db,2015,2016,'F')['items'][0]['id'],'F')
            self.assertEqual({r['id'] for r in concepts(db,2010,2014,categories=['Y'],seeds=['B'])['items']},{'B'})
            self.assertEqual({r['id'] for r in concepts(db,2010,2014,categories=['X','Y'],operator='and')['items']},{'A','B','C','D'})
            self.assertEqual({r['id'] for r in concepts(db,2010,2014,categories=['Y'],operator='or')['items']},{'B','D'})
            self.assertEqual({r['id'] for r in concepts(db,2010,2014,seeds=['A'])['items']},{'A','B','D'})

    def test_mesh_version_unavailable_and_historical_tree_distance(self):
        with closing(connect(self.path)) as db:
            self.assertIsNone(tree_distance(db,'A','C',2014))
            with self.assertRaisesRegex(ValueError,'histórico indisponível'): candidate(db,'A','C',2014,strict=True)
            for mid,tree in [('A','C01.100'),('C','C01.200')]:
                db.execute('INSERT INTO mesh_versions VALUES(?,?,?,?,?,?,?)',(mid,'2014','Descriptor',2014,2014,mid,json.dumps({'treeNumbers':[tree]})))
            self.assertEqual(tree_distance(db,'A','C',2014)['value'],2)
            self.assertIsNone(tree_distance(db,'A','C',2013))


if __name__=='__main__': unittest.main()
