"""Append-only scientific snapshots; future validation never overwrites hypotheses."""
from contextlib import closing
from datetime import datetime,timezone
import hashlib
import json
import uuid

from map_store import connect
from lbd_engine import edge_evidence,pair_count

SCHEMA='''CREATE TABLE IF NOT EXISTS hypothesis_ledger (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL, knowledge_cutoff INTEGER NOT NULL,
 a TEXT NOT NULL,c TEXT NOT NULL,corpus_revision TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hypothesis_cutoff ON hypothesis_ledger(knowledge_cutoff,created_at);
CREATE TABLE IF NOT EXISTS validation_ledger (
 id TEXT PRIMARY KEY,hypothesis_id TEXT NOT NULL REFERENCES hypothesis_ledger(id),created_at TEXT NOT NULL,
 start_year INTEGER NOT NULL,end_year INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS validation_hypothesis ON validation_ledger(hypothesis_id,created_at);
'''
STATUSES={'NO_FUTURE_EVIDENCE','WEAK_SIGNAL','PARTIAL_SUPPORT','SUBSTANTIAL_SUPPORT','CONTRADICTED','INCONCLUSIVE'}


def now(): return datetime.now(timezone.utc).isoformat()


def canonical(value): return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))


def initialize(db):
    db.executescript(SCHEMA)
    if hasattr(db,'db'):  # PostgreSQL adapter
        db.execute("""CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Ledger is append-only'; END $$""")
        for table in ('hypothesis_ledger','validation_ledger'):
            exists=db.execute('SELECT 1 FROM pg_trigger WHERE tgname=?',(table+'_immutable',)).fetchone()
            if not exists: db.execute(f'CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()')
    else:
        for table in ('hypothesis_ledger','validation_ledger'):
            for operation in ('UPDATE','DELETE'):
                db.execute(f"CREATE TRIGGER IF NOT EXISTS {table}_{operation.lower()} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END")
    db.commit()


def save_hypothesis(path,detail,agents):
    if not detail['eligible']: raise ValueError('A-C já observado até o corte')
    identity=str(uuid.uuid4())
    value={'id':identity,'createdAt':now(),'knowledgeCutoff':detail['knowledgeCutoff'],
        'candidate':detail,'agents':agents,'hypothesisText':agents['synthesis']['hypothesis'],
        'mechanismText':agents['synthesis']['mechanism'],'testablePrediction':agents['synthesis']['testable_prediction'],
        'limitations':agents['synthesis']['limitations'],'agentModel':agents['agentModel'],
        'agentVersion':agents['agentVersion'],'promptVersion':agents['promptVersion']}
    payload=canonical(value)
    with closing(connect(path)) as db:
        db.execute('INSERT INTO hypothesis_ledger VALUES(?,?,?,?,?,?,?,?)',(identity,value['createdAt'],value['knowledgeCutoff'],
            detail['A']['id'],detail['C']['id'],detail['corpusRevision'],payload,hashlib.sha256(payload.encode()).hexdigest()))
        db.commit()
    return value


def get_hypothesis(db,identity):
    row=db.execute('SELECT payload,sha256 FROM hypothesis_ledger WHERE id=?',(identity,)).fetchone()
    if not row: raise ValueError('Hipótese não encontrada')
    if hashlib.sha256(row[0].encode()).hexdigest()!=row[1]: raise ValueError('Integridade da hipótese inválida')
    return json.loads(row[0])


def list_hypotheses(db,cutoff=None):
    where=' WHERE knowledge_cutoff=?' if cutoff is not None else ''
    return [json.loads(row[0]) for row in db.execute('SELECT payload FROM hypothesis_ledger'+where+' ORDER BY created_at DESC,id LIMIT 100',(cutoff,) if cutoff is not None else ())]


def validations(db,identity):
    return [json.loads(row[0]) for row in db.execute('SELECT payload FROM validation_ledger WHERE hypothesis_id=? ORDER BY created_at DESC,id',(identity,))]


def validate_hypothesis(db,identity,end=None,review=None):
    hypothesis=get_hypothesis(db,identity)
    cutoff=hypothesis['knowledgeCutoff']
    maximum=db.execute('SELECT MAX(year) FROM articles').fetchone()[0]
    end=maximum if end is None else end
    if type(end) is not int or end>maximum or end<cutoff: raise ValueError('Janela de validação inválida')
    start=cutoff+1
    detail=hypothesis['candidate'];a,c=detail['A']['id'],detail['C']['id']
    count,first=pair_count(db,a,c,end,start)
    articles=edge_evidence(db,a,c,start,end,limit=100)
    status='INCONCLUSIVE' if end<start else 'WEAK_SIGNAL' if count else 'NO_FUTURE_EVIDENCE'
    rationale='Coindexação posterior é somente sinal bibliográfico; não confirma o mecanismo.' if count else 'Nenhum artigo com A-C observado nesta janela do corpus.'
    if end<start: rationale='Ainda não há janela posterior ao corte no corpus.'
    if review:
        status=review.get('status')
        if status not in STATUSES: raise ValueError('Status de revisão inválido')
        if not isinstance(review.get('reviewer'),str) or not review['reviewer'].strip() or not isinstance(review.get('rationale'),str) or not review['rationale'].strip(): raise ValueError('Revisão exige identificação e justificativa')
        ids=review.get('pmids',[])
        if not isinstance(ids,list) or not set(ids)<=set(p['pmid'] for p in articles): raise ValueError('PMID fora da evidência futura fornecida')
        if status in {'PARTIAL_SUPPORT','SUBSTANTIAL_SUPPORT','CONTRADICTED'} and not ids: raise ValueError('Status interpretativo exige evidência identificada')
        rationale=review['rationale']
    result={'id':str(uuid.uuid4()),'hypothesisId':identity,'createdAt':now(),'validationStartYear':start,'validationEndYear':end,
        'firstFutureEvidenceYear':first,'futureArticleCount':count,'futureCooccurrenceCount':count,'futureEvidence':articles,
        'validationStatus':status,'rationale':rationale,'review':review,'evidenceTruncated':count>len(articles),
        'corpusRevision':json.loads(db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]),
        'leadTimeYears':first-cutoff if first else None,'statusPolicy':'bibliographic-signal-human-review-v1'}
    db.execute('INSERT INTO validation_ledger VALUES(?,?,?,?,?,?,?)',(result['id'],identity,result['createdAt'],start,end,status,canonical(result)))
    db.commit()
    return result


def validateHypothesisAtCutoff(db,cutoff):
    rows=db.execute('SELECT id FROM hypothesis_ledger WHERE knowledge_cutoff=? ORDER BY id',(cutoff,)).fetchall()
    results=[validate_hypothesis(db,row[0]) for row in rows]
    reviews=[next((v for v in validations(db,row[0]) if v.get('review')),None) for row in rows]
    return {'cutoffYear':cutoff,'nHypotheses':len(rows),'statusCounts':{status:sum(r['validationStatus']==status for r in results) for status in sorted(STATUSES)},
        'humanReviewCounts':{status:sum(r is not None and r['validationStatus']==status for r in reviews) for status in sorted(STATUSES)},
        'withFutureEvidence':sum(r['futureArticleCount']>0 for r in results),
        'alreadyKnownAtCutoff':sum(get_hypothesis(db,row[0])['candidate']['directCount']>0 for row in rows),
        'leadTimeYears':[r['leadTimeYears'] for r in results if r['leadTimeYears'] is not None],
        'results':results,'interpretation':'Backtest de coindexação; não estima taxa de descobertas confirmadas.'}
