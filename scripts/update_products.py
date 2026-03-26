import requests
import json
import os
from xml.etree import ElementTree
from bs4 import BeautifulSoup

# Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, 'docs', 'assets')
SEVEN_ELEVEN_JSON = os.path.join(ASSETS_DIR, "seven_eleven_products.json")
FAMILY_MART_JSON = os.path.join(ASSETS_DIR, "family_mart_products.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
}

def load_json(filepath):
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_json(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def crawl_711():
    base_url = "https://www.7-11.com.tw/freshfoods/Read_Food_xml_hot.aspx"
    categories = [
        "19_star", "1_Ricerolls", "16_sandwich", "2_Light", "3_Cuisine",
        "4_Snacks", "5_ForeignDishes", "6_Noodles", "7_Oden", "8_Bigbite",
        "9_Icecream", "10_Slurpee", "11_bread", "hot", "12_steam",
        "13_luwei", "15_health", "17_ohlala", "18_veg", "20_panini", "21_ice", "22_ice"
    ]
    data = []
    for index, category in enumerate(categories):
        params = {"": index}
        response = requests.get(base_url, headers=HEADERS, params=params)
        if response.status_code == 200:
            try:
                root = ElementTree.fromstring(response.content)
                for item in root.findall(".//Item"):
                    data.append({
                        "category": category,
                        "name": item.findtext("name", ""),
                        "kcal": item.findtext("kcal", ""),
                        "price": item.findtext("price", ""),
                        "image": f'https://www.7-11.com.tw/freshfoods/{category}/' + item.findtext("image", ""),
                        "special_sale": item.findtext("special_sale", ""),
                        "new": item.findtext("new", ""),
                        "content": item.findtext("content", ""),
                    })
            except ElementTree.ParseError:
                pass
    return data

def crawl_family_mart():
    url = "https://foodsafety.family.com.tw/Web_FFD_2022/ws/QueryFsProductListByFilter"
    payload = {
        "MEMBER": "N",
        "KEYWORD": "",
        "INCLUDE_CLB": "N"
    }
    response = requests.post(url, json=payload, headers=HEADERS)
    results = []
    if response.status_code == 200:
        json_data = response.json()
        if json_data.get("RESULT_CODE") == "00":
            for category_data in json_data.get("LIST", []):
                category_name = category_data.get("CATEGORY_NAME", "")
                for item in category_data.get("ITEM", []):
                    results.append({
                        "category": category_name,
                        "title": item.get("PRODNAME", ""),
                        "picture_url": f"https://foodsafety.family.com.tw/product_img/{item.get('PROD_PIC', '')}",
                        "Protein": "",
                        "Carb": "",
                        "Calories": "",
                        "Fat": "",
                        "Description": item.get("NOTE", ""),
                    })
    return results

def crawl_family_mart_fresh():
    url = "https://www.family.com.tw/Marketing/zh/FreshFood/Product"
    response = requests.get(url, headers=HEADERS)
    soup = BeautifulSoup(response.text, "html.parser")
    results = []
    
    tab_panes = soup.select(".tab-pane")
    for pane in tab_panes:
        cat_title_el = pane.select_one(".tab-title")
        category = cat_title_el.text.strip() if cat_title_el else "美味鮮食"
        
        cards = pane.select(".card")
        for card in cards:
            more_link = card.select_one(".food__more")
            if more_link:
                title = more_link.get("data-name", "").strip()
                desc = more_link.get("data-desc", "").strip()
                img_path = more_link.get("data-img", "").strip()
                picture_url = f"https://www.family.com.tw{img_path}" if img_path else ""
                
                kcal_el = card.select_one(".food__kcal")
                kcal = kcal_el.text.strip() if kcal_el else ""
                
                results.append({
                    "category": category,
                    "title": title,
                    "picture_url": picture_url,
                    "Protein": "",
                    "Carb": "",
                    "Calories": kcal,
                    "Fat": "",
                    "Description": desc
                })
    return results

def report_diff(old_data, new_data, store_name, name_key="name"):
    old_set = set((item['category'], item[name_key]) for item in old_data)
    new_set = set((item['category'], item[name_key]) for item in new_data)

    added = new_set - old_set
    removed = old_set - new_set

    report = []
    report.append(f"\n### {store_name} 變動報告")
    report.append(f"**新增商品 ({len(added)}):**")
    if not added:
        report.append("  (無)")
    for cat, name in sorted(added):
        report.append(f"  - [{cat}] {name}")
    
    report.append(f"\n**下架商品 ({len(removed)}):**")
    if not removed:
        report.append("  (無)")
    for cat, name in sorted(removed):
        report.append(f"  - [{cat}] {name}")
    
    return "\n".join(report), added, removed

def main():
    print("正在取得 7-Eleven 最新資料...")
    old_711 = load_json(SEVEN_ELEVEN_JSON)
    new_711 = crawl_711()
    
    print("正在取得 全家 最新資料...")
    old_fm = load_json(FAMILY_MART_JSON)
    new_fm = crawl_family_mart()
    
    print("正在取得 全家 鮮食新活動資料...")
    new_fm_fresh = crawl_family_mart_fresh()
    # Combine the two FamilyMart lists
    new_fm.extend(new_fm_fresh)

    # Identify and merge rather than replace
    report711, added_items_711, removed711 = report_diff(old_711, new_711, "7-Eleven", name_key="name")
    reportfm, added_items_fm, removedfm = report_diff(old_fm, new_fm, "全家", name_key="title")

    # Filter out items that are already in the old list to avoid duplicates
    # Since report_diff already gave us 'added' (new products not in old list),
    # we just append those to the old list.
    
    # Actually, we should be careful about which 'new' data to keep
    # In this case, we'll keep all 'old' items and just append the 'added' items.
    
    merged_711 = old_711.copy()
    existing_sets_711 = set((item['category'], item['name']) for item in old_711)
    for item in new_711:
        if (item['category'], item['name']) not in existing_sets_711:
            merged_711.append(item)
            existing_sets_711.add((item['category'], item['name']))

    merged_fm = old_fm.copy()
    existing_sets_fm = set((item['category'], item['title']) for item in old_fm)
    for item in new_fm:
        if (item['category'], item['title']) not in existing_sets_fm:
            merged_fm.append(item)
            existing_sets_fm.add((item['category'], item['title']))

    full_report = "# 便利商店商品更新報告 (僅新增，無下架)\n" + report711 + reportfm
    print(full_report)

    report_file = os.path.join(BASE_DIR, 'scripts', 'update_report.md')
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(full_report)

    print("\n正在更新 JSON 檔案...")
    # Update both docs/assets and src/assets
    SRC_ASSETS_DIR = os.path.join(BASE_DIR, 'src', 'assets')
    
    save_json(SEVEN_ELEVEN_JSON, merged_711)
    save_json(os.path.join(SRC_ASSETS_DIR, "seven_eleven_products.json"), merged_711)
    
    save_json(FAMILY_MART_JSON, merged_fm)
    save_json(os.path.join(SRC_ASSETS_DIR, "family_mart_products.json"), merged_fm)
    
    print(f"更新完成！已將新商品加入清單並保留舊商品（同步更新 docs/ 與 src/）。報告已儲存至 {report_file}")

if __name__ == "__main__":
    main()
