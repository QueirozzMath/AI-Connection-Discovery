from contextlib import closing
import json
import sqlite3
import unittest
from unittest.mock import patch,MagicMock

from test_lbd import LBDTests
from map_store import connect
from lbd_jobs import setup,execute,dispatch
from agent_runtime import run_agents,validate_claims,AgentRuntime
from hypothesis_ledger import get_hypothesis,validate_hypothesis,validateHypothesisAtCutoff


class FixtureRuntime:
    model='fixture';kind='test-only'
    def generate(self,system,context):
        if 'Papel DiscoveryInterpreter.' in system:
            return {'interpretation':'Caminhos coindexados, sem mecanismo demonstrado.','claims':[]}
        if 'Papel ContradictionAgent' in system:
            return {'critique':'Ausência de texto integral; possíveis confundidores.','limitations':['Títulos apenas'],'alternatives':['Confundimento'],'claims':[]}
        return {'title':'Hipótese de teste','hypothesis':'A-C pode ser investigado pelas pontes.',
            'mechanism':'Mecanismo adicional a testar','mechanismStatus':'speculative',
            'bridge_reasoning':'Duas pontes bibliográficas.','testable_prediction':'Testar associação A-C em estudo independente.',
            'limitations':['Coindexação não prova mecanismo'],'claims':[]}


class LedgerAgentTests(LBDTests):
    def setUp(self):
        super().setUp();setup(self.path)

    def generate(self):
        return execute(self.path,{'operation':'generate','startYear':2010,'endYear':2014,'a':'A','c':'C'},FixtureRuntime())

    def test_hypothesis_frozen_and_future_validation_appended(self):
        hypothesis=self.generate()
        with closing(connect(self.path)) as db:
            before=get_hypothesis(db,hypothesis['id'])
            result=validate_hypothesis(db,hypothesis['id'],2016)
            self.assertEqual(result['validationStatus'],'WEAK_SIGNAL')
            self.assertEqual(result['firstFutureEvidenceYear'],2015)
            self.assertEqual(result['futureArticleCount'],1)
            self.assertEqual(get_hypothesis(db,hypothesis['id']),before)
            for table in ('hypothesis_ledger','validation_ledger'):
                with self.assertRaises(sqlite3.IntegrityError): db.execute(f'DELETE FROM {table}')
                db.rollback()
            with self.assertRaises(sqlite3.IntegrityError): db.execute("UPDATE hypothesis_ledger SET payload='{}'")
            db.rollback()

    def test_review_requires_identified_future_evidence(self):
        hypothesis=self.generate()
        with closing(connect(self.path)) as db:
            with self.assertRaisesRegex(ValueError,'PMID fora'):
                validate_hypothesis(db,hypothesis['id'],2016,{'status':'CONTRADICTED','reviewer':'test reviewer','rationale':'review','pmids':['1']})
            review=validate_hypothesis(db,hypothesis['id'],2016,{'status':'CONTRADICTED','reviewer':'test reviewer','rationale':'Explicit human assessment in fixture','pmids':['5']})
            self.assertEqual(review['validationStatus'],'CONTRADICTED')
            self.assertEqual(review['review']['reviewer'],'test reviewer')
            result=validateHypothesisAtCutoff(db,2014)
            self.assertEqual(result['humanReviewCounts']['CONTRADICTED'],1)
            self.assertEqual(result['statusCounts']['WEAK_SIGNAL'],1)

    def test_absence_and_prospective_no_future_window(self):
        hypothesis=self.generate()
        with closing(connect(self.path)) as db:
            self.assertEqual(validate_hypothesis(db,hypothesis['id'],2014)['validationStatus'],'INCONCLUSIVE')
            db.execute("DELETE FROM articles WHERE pmid='5'")
            db.execute('DELETE FROM pair_year WHERE year=2015');db.commit()
            self.assertEqual(validate_hypothesis(db,hypothesis['id'],2016)['validationStatus'],'NO_FUTURE_EVIDENCE')

    def test_backtest_uses_stored_hypothesis_cutoff(self):
        self.generate()
        with closing(connect(self.path)) as db:
            result=validateHypothesisAtCutoff(db,2014)
            self.assertEqual(result['nHypotheses'],1)
            self.assertEqual(result['leadTimeYears'],[1])
            self.assertEqual(result['alreadyKnownAtCutoff'],0)

    def test_five_agent_roles_and_speculative_mechanism(self):
        result=run_agents(self.detail(),FixtureRuntime())
        for role in ('interpreter','evidenceAgent','contradictionAgent','temporalAgent','synthesis'):
            self.assertIn(role,result)
        self.assertEqual(result['synthesis']['mechanismStatus'],'speculative')
        self.assertNotIn('confidence',result['synthesis'])
        self.assertTrue(result['temporalAgent']['allEvidenceBeforeCutoff'])

    def test_llm_invalid_response_and_fabricated_reference_rejected(self):
        for output in ({'claims':[{'kind':'observed','statement':'fake fact','evidence':[]}]},
                       {'confidence':.9,'claims':[]},
                       {'claims':[{'kind':'inference','statement':'Claim','evidence':[{'pmid':'999','quote':'invented'}]}]},
                       {'claims':[{'kind':'inference','statement':'Claim','evidence':[]}]}):
            with self.assertRaises(ValueError): validate_claims(output,{})

    def test_unavailable_runtime_does_not_create_hypothesis(self):
        import urllib.error
        with patch('urllib.request.urlopen',side_effect=urllib.error.URLError('offline')):
            with self.assertRaisesRegex(RuntimeError,'LLM indisponível'): run_agents(self.detail(),AgentRuntime())
        with closing(connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM hypothesis_ledger').fetchone()[0],0)

    def test_runtime_without_user_key_and_invalid_json(self):
        with patch.dict('os.environ',{},clear=True):
            runtime=AgentRuntime()
            self.assertEqual(runtime.kind,'ollama')
            self.assertEqual(runtime.model,'qwen2.5:1.5b')
            runtime.kind='compatible'
            response=MagicMock()
            response.__enter__.return_value.read.return_value=b'not json'
            with patch('urllib.request.urlopen',return_value=response):
                with self.assertRaisesRegex(ValueError,'Resposta LLM inválida'): runtime.generate('system',{})

    def test_job_idempotency(self):
        import uuid
        data={'operation':'generate','requestId':str(uuid.uuid4()),'startYear':2010,'endYear':2014,'a':'A','c':'C'}
        self.assertEqual(dispatch(self.path,data),dispatch(self.path,data))
        with closing(connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM lbd_jobs').fetchone()[0],1)


if __name__=='__main__': unittest.main()
