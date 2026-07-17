import os
import time
import json
import urllib.request
import urllib.parse
import openpyxl
from datetime import datetime

# ── CONFIGURAÇÕES ──────────────────────────────────────────────────
# Altere o caminho abaixo para a pasta do SharePoint onde as OPs são salvas
WATCH_DIR = r"c:\Users\gcall\Kuryos\Servidor Kuryos - Documentos\04. Design de Produtos e PCP\7. Sistema Contagem Prod\producao_firebase_FINAL"
DB_URL = "https://prod-kuryos-default-rtdb.firebaseio.com"
PROCESSED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "processed_ops.json")
# ───────────────────────────────────────────────────────────────────

def sanitize_key(val):
    s = str(val or '').replace('.', '-').replace('/', '-').replace('[', '-').replace(']', '-').replace('#', '-').replace('$', '-')
    s = '_'.join(s.split())
    return s[:60]

def clean_produto(val):
    if not val:
        return ""
    s = str(val).split('>')[0]
    s = s.split(' - ')[0]
    return s.strip()

def get_base_pedido_key(op_id, product):
    return sanitize_key(op_id) + '__' + sanitize_key(clean_produto(product))

def load_processed():
    if os.path.exists(PROCESSED_FILE):
        try:
            with open(PROCESSED_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_processed(data):
    try:
        with open(PROCESSED_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print("Erro ao salvar log de processados:", e)

def process_file(file_path):
    print(f"\nDetectado novo arquivo: {os.path.basename(file_path)}")
    try:
        # data_only=True garante a leitura do valor calculado das fórmulas
        wb = openpyxl.load_workbook(file_path, data_only=True)
        if "OP 1" not in wb.sheetnames:
            print("  -> Aba 'OP 1' não encontrada. Ignorando.")
            return False
            
        sheet = wb["OP 1"]
        op_id = sheet["F2"].value
        date_val = sheet["A7"].value
        sku = sheet["A11"].value
        product = sheet["B11"].value
        qty_val = sheet["E11"].value
        
        if not op_id or not product:
            print("  -> F2 (ID da OP) ou B11 (Descrição) vazios. Ignorando.")
            return False
            
        op_id = str(op_id).strip()
        product = clean_produto(product)
        qty = int(qty_val) if qty_val is not None else 0
        
        if qty <= 0:
            print(f"  -> Quantidade E11 ({qty}) é menor ou igual a zero. Ignorando.")
            return False
            
        # Converter data para YYYY-MM-DD
        date_str = ""
        if isinstance(date_val, datetime):
            date_str = date_val.strftime("%Y-%m-%d")
        elif date_val:
            date_str = str(date_val)[:10]
            
        fb_key = get_base_pedido_key(op_id, product)
        
        # Conecta no Firebase para verificar se já existe e preservar dados de apontamento anteriores
        url = f"{DB_URL}/pedidos/{fb_key}.json"
        req = urllib.request.Request(url)
        existing = {}
        try:
            with urllib.request.urlopen(req) as response:
                res = response.read()
                if res and res != b'null':
                    existing = json.loads(res.decode('utf-8'))
        except Exception as e:
            print("  -> Nota: Erro ou OP nova no Firebase:", e)
            
        data = {
            "id": op_id,
            "produto": product,
            "sku": str(sku).strip() if sku else "",
            "qtdTotal": qty,
            "dataProd": date_str,
            "linha": existing.get("linha", ""),
            "status": existing.get("status", "Programado"),
            "priority": existing.get("priority", 999),
            "ordenacao": existing.get("ordenacao", 999999999),
            "produzido": existing.get("produzido", 0),
            "ultimoApontamento": existing.get("ultimoApontamento", ""),
            "insumosChecklist": existing.get("insumosChecklist", {})
        }
        
        # Envia via PUT para o Firebase
        data_json = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(url, data=data_json, method='PUT')
        req.add_header('Content-Type', 'application/json')
        
        with urllib.request.urlopen(req) as response:
            print(f"  -> SUCESSO: OP {op_id} sincronizada no Firebase!")
            return True
            
    except Exception as e:
        print("  -> Falha ao processar planilha:", e)
        return False

def scan_folder():
    processed = load_processed()
    changed = False
    
    for f in os.listdir(WATCH_DIR):
        # Apenas arquivos Excel, ignorando temporários do Office (~$)
        if not f.endswith(".xlsx") or f.startswith("~$"):
            continue
            
        file_path = os.path.join(WATCH_DIR, f)
        try:
            mtime = os.path.getmtime(file_path)
        except:
            continue # arquivo bloqueado ou em gravação temporária
            
        # Processa se o arquivo for novo ou o horário de modificação mudou
        if f not in processed or processed[f] < mtime:
            # Aguarda 1.5s para garantir que o Excel terminou de gravar e liberar o arquivo
            time.sleep(1.5)
            success = process_file(file_path)
            if success:
                processed[f] = mtime
                changed = True
                
    if changed:
        save_processed(processed)

if __name__ == "__main__":
    print("==========================================================")
    print("       KURYOS PCP - WATCHER DE PLANILHAS DE OP            ")
    print("==========================================================")
    print(f"Monitorando a pasta: {WATCH_DIR}")
    print("Sincronizando em tempo real com Firebase...")
    print("Pressione Ctrl+C para encerrar o monitoramento.")
    print("----------------------------------------------------------")
    while True:
        try:
            scan_folder()
            time.sleep(5) # Varre a pasta a cada 5 segundos
        except KeyboardInterrupt:
            print("\nMonitoramento encerrado pelo usuário.")
            break
        except Exception as e:
            print("Erro de varredura:", e)
            time.sleep(5)
