"""Durable bounded inbox processed outside web requests by one scientific worker."""
from contextlib import closing
import json
import threading
import time
import uuid

from map_store import connect, SCHEMA as STORE_SCHEMA
from lbd_engine import MESH_SCHEMA, candidate, discover, validate_period
from hypothesis_ledger import initialize,now,get_hypothesis,list_hypotheses,validations,validate_hypothesis,validateHypothesisAtCutoff,save_hypothesis
from agent_runtime import run_agents

SCHEMA='''CREATE TABLE IF NOT EXISTS lbd_jobs (
 id TEXT PRIMARY KEY,created_at TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,
 result TEXT,error TEXT
);'''
WAKE=threading.Event()


def setup(path):
    with closing(connect(path)) as db:
        db.executescript(STORE_SCHEMA+MESH_SCHEMA+SCHEMA)
        initialize(db)


def dispatch(path,data):
    operation=data.get('operation')
    with closing(connect(path)) as db:
        if operation=='status':
            row=db.execute('SELECT status,result,error FROM lbd_jobs WHERE id=?',(data.get('id'),)).fetchone()
            if not row: raise ValueError('Job não encontrado')
            return {'status':row[0],'result':json.loads(row[1]) if row[1] else None,'error':row[2]}
        if operation=='list': return {'items':list_hypotheses(db,data.get('cutoffYear'))}
        if operation=='get': return {'hypothesis':get_hypothesis(db,data.get('id')),'validations':validations(db,data.get('id'))}
        if operation not in ('discover','candidate','generate','validate','review','backtest'): raise ValueError('Operação LBD inválida')
        identity=data.get('requestId')
        try: uuid.UUID(identity)
        except (ValueError,TypeError,AttributeError) as exc: raise ValueError('requestId deve ser UUID') from exc
        if operation in ('discover','candidate','generate'): validate_period(db,data)
        payload=json.dumps(data,sort_keys=True,ensure_ascii=False)
        existing=db.execute('SELECT input FROM lbd_jobs WHERE id=?',(identity,)).fetchone()
        if existing and existing[0]!=payload: raise ValueError('requestId já pertence a outra solicitação')
        if existing: return {'id':identity,'status':'pending'}
        if db.execute("SELECT COUNT(*) FROM lbd_jobs WHERE status IN ('pending','running')").fetchone()[0]>=8:
            return {'status':'busy','error':'Fila científica ocupada; tente novamente.'}
        db.execute("INSERT INTO lbd_jobs VALUES(?,?,'pending',?,NULL,NULL) ON CONFLICT(id) DO NOTHING",(identity,now(),payload))
        db.commit()
    WAKE.set()
    return {'id':identity,'status':'pending'}


def execute(path,data,runtime=None):
    operation=data['operation']
    with closing(connect(path)) as db:
        # A repeatable snapshot prevents ingestion changing a candidate mid-query.
        db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ' if hasattr(db,'db') else 'BEGIN')
        if operation=='discover': return discover(db,data)
        if operation in ('candidate','generate'):
            start,end=validate_period(db,data)
            detail=candidate(db,data.get('a'),data.get('c'),end,start,data.get('strictHistorical',False),data.get('mode','closed'))
            if operation=='candidate': return detail
        elif operation in ('validate','review'):
            return validate_hypothesis(db,data.get('hypothesisId'),data.get('validationEndYear'),data.get('review') if operation=='review' else None)
        elif operation=='backtest':
            if type(data.get('cutoffYear')) is not int: raise ValueError('Corte inválido')
            return validateHypothesisAtCutoff(db,data['cutoffYear'])
        else: raise ValueError('Operação desconhecida')
    agents=run_agents(detail,runtime)
    return save_hypothesis(path,detail,agents)


def start_worker(path):
    with closing(connect(path)) as db:
        db.execute("UPDATE lbd_jobs SET status='error',error='Serviço reiniciado; solicite nova execução. Hipóteses já registradas permanecem congeladas.' WHERE status='running'")
        db.commit()
    def loop():
        while True:
            with closing(connect(path)) as db:
                row=db.execute("SELECT id,input FROM lbd_jobs WHERE status='pending' ORDER BY created_at,id LIMIT 1").fetchone()
                if row:
                    db.execute("UPDATE lbd_jobs SET status='running' WHERE id=? AND status='pending'",(row[0],));db.commit()
            if not row:
                WAKE.wait(1);WAKE.clear();continue
            started=time.monotonic()
            try:
                result=execute(path,json.loads(row[1]))
                with closing(connect(path)) as db:
                    db.execute("UPDATE lbd_jobs SET status='complete',result=? WHERE id=?",(json.dumps(result,ensure_ascii=False),row[0]));db.commit()
            except Exception as error:
                with closing(connect(path)) as db:
                    db.execute("UPDATE lbd_jobs SET status='error',error=? WHERE id=?",(str(error)[:1000],row[0]));db.commit()
            print(json.dumps({'lbdJob':row[0],'durationSeconds':round(time.monotonic()-started,3)}),flush=True)
    threading.Thread(target=loop,daemon=True,name='lbd-science').start()
