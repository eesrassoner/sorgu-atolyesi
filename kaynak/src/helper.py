import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
import pandas as pd, numpy as np, json, io, sys, ast, traceback, re, datetime

_BASE = {}
_TARIH = re.compile(r'^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$')

def _yukle(js):
    _BASE.clear()
    veri = json.loads(js)
    for ad, t in veri.items():
        df = pd.DataFrame(t['rows'], columns=t['columns'])
        for c in df.columns:
            if df[c].dtype == object or pd.api.types.is_string_dtype(df[c]):
                dolu = df[c].dropna()
                if len(dolu) and dolu.map(lambda v: isinstance(v, str) and bool(_TARIH.match(v))).all():
                    df[c] = pd.to_datetime(df[c], errors='coerce')
        _BASE[ad] = df
    return json.dumps({a: [[c, str(d)] for c, d in df.dtypes.items()] for a, df in _BASE.items()})

def _deger(v):
    if v is None:
        return None
    if isinstance(v, (pd.Timestamp, datetime.datetime)):
        if pd.isna(v):
            return None
        return v.strftime('%Y-%m-%d') if (v.hour, v.minute, v.second) == (0, 0, 0) else v.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, pd.Timedelta):
        return None if pd.isna(v) else str(v)
    if isinstance(v, (pd.Period, pd.Interval)):
        return str(v)
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if np.isnan(v) else float(v)
    if isinstance(v, (int, str)):
        return v
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    return str(v)

def _tablo(obj, limit=5000):
    tur = type(obj).__name__
    if obj is None:
        return None
    if isinstance(obj, pd.Series):
        ad = obj.name if obj.name is not None else 'deger'
        df = obj.to_frame(name=ad)
        isimsiz_sayi = obj.index.name is None and not isinstance(obj.index, pd.MultiIndex) and pd.api.types.is_integer_dtype(obj.index)
        if isimsiz_sayi:
            df = df.reset_index(drop=True)
        else:
            if ad in [n for n in df.index.names if n is not None]:
                df.columns = [str(ad) + '_deger']
            df = df.reset_index()
    elif isinstance(obj, pd.DataFrame):
        df = obj
        if isinstance(df.index, pd.MultiIndex) or df.index.name is not None:
            df = df.reset_index()
        elif not isinstance(df.index, pd.RangeIndex) and not pd.api.types.is_integer_dtype(df.index):
            df = df.reset_index()
        else:
            df = df.reset_index(drop=True)
    elif isinstance(obj, np.ndarray) and obj.ndim == 2:
        df = pd.DataFrame(obj, columns=[f'sutun_{i+1}' for i in range(obj.shape[1])])
    elif isinstance(obj, tuple) and len(obj) > 0 and all(isinstance(x, np.ndarray) and x.ndim == 1 for x in obj) and len({len(x) for x in obj}) == 1:
        df = pd.DataFrame({f'deger_{i+1}': list(x) for i, x in enumerate(obj)})
    elif isinstance(obj, (tuple, list)) and all(not isinstance(x, (list, tuple, dict, pd.Series, pd.DataFrame, np.ndarray)) for x in obj):
        if isinstance(obj, tuple):
            df = pd.DataFrame([list(obj)], columns=[f'deger_{i+1}' for i in range(len(obj))])
        else:
            df = pd.DataFrame({'deger': list(obj)})
    elif isinstance(obj, dict):
        df = pd.DataFrame({'anahtar': list(obj.keys()), 'deger': [str(v) if isinstance(v, (list, dict)) else v for v in obj.values()]})
    elif isinstance(obj, (pd.Index, np.ndarray)):
        df = pd.DataFrame({'deger': list(np.asarray(obj).ravel())})
    elif np.isscalar(obj) or isinstance(obj, (pd.Timestamp, pd.Timedelta)):
        df = pd.DataFrame({'deger': [obj]})
    else:
        return {'columns': ['deger'], 'rows': [[repr(obj)[:2000]]], 'total': 1, 'tur': tur}
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = ['_'.join(str(x) for x in c if str(x) != '') for c in df.columns]
    cols = [str(c) for c in df.columns]
    rows = [[_deger(v) for v in r] for r in df.head(limit).itertuples(index=False, name=None)]
    return {'columns': cols, 'rows': rows, 'total': int(len(df)), 'tur': tur}

def _calistir(kod):
    ns = {'pd': pd, 'np': np}
    for k, v in _BASE.items():
        ns[k] = v.copy()
    buf = io.StringIO()
    eski = sys.stdout
    sys.stdout = buf
    try:
        agac = ast.parse(kod)
        son = None
        if agac.body and isinstance(agac.body[-1], ast.Expr):
            ifade = ast.Expression(agac.body.pop().value)
            exec(compile(agac, '<kod>', 'exec'), ns)
            son = eval(compile(ifade, '<kod>', 'eval'), ns)
        else:
            exec(compile(agac, '<kod>', 'exec'), ns)
        deger = ns['sonuc'] if 'sonuc' in ns else son
        return json.dumps({'ok': True, 'stdout': buf.getvalue()[-20000:], 'table': _tablo(deger), 'sonucVar': 'sonuc' in ns})
    except Exception as e:
        satir = ''
        tb = traceback.extract_tb(sys.exc_info()[2])
        for f in tb:
            if f.filename == '<kod>':
                satir = f' (satır {f.lineno})'
        if isinstance(e, SyntaxError):
            satir = f' (satır {e.lineno})'
        return json.dumps({'ok': False, 'stdout': buf.getvalue()[-20000:], 'error': f'{type(e).__name__}: {e}{satir}'})
    finally:
        sys.stdout = eski
