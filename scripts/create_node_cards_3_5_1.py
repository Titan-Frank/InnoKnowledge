#!/usr/bin/env python3
"""Create node cards for lesson 3-5-1 extracted nodes"""

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def create_node_card(
    node_id: str, title: str, summary: str, sections: list, evidence_refs: list
):
    """Create a node card using expand_node_sqlite.py"""

    cmd = [
        "python",
        "scripts/expand_node_sqlite.py",
        "--node-id",
        node_id,
        "--db",
        "storage/knowledge.sqlite",
        "--dataset-id",
        "v4",
        "--title",
        title,
        "--summary",
        summary,
        "--sections",
        json.dumps(sections, ensure_ascii=False),
        "--source-refs",
        json.dumps(evidence_refs, ensure_ascii=False),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)

    if result.returncode == 0:
        print(f"✓ Created node card for {node_id}")
        return True
    else:
        print(f"✗ Failed to create node card for {node_id}")
        print(f"  Error: {result.stderr}")
        return False


def main():
    # Node cards data
    node_cards = [
        # ============================================
        # 1. 原子 (Atom)
        # ============================================
        {
            "node_id": "concept:atom",
            "title": "原子",
            "summary": "原子是化学变化中的最小微观粒子，是构成物质的基本单元。在化学变化中，原子本身不发生变化，但可以重新组合形成新的分子。原子既可以结合成分子间接构成物质，也能直接构成物质（如金属、稀有气体等）。原子呈电中性，由原子核和核外电子构成。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "原子是化学变化中的最小微观粒子。在化学变化中，分子会发生变化，而原子本身不发生变化，只是重新组合形成新的分子，进而构成新的物质。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "原子的本质是化学变化中不可再分的基本粒子。在物理变化中，原子保持完整；在化学变化中，原子重新排列组合但不破裂。原子是连接微观世界与宏观物质的桥梁。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 原子是化学变化中的最小粒子（不是物理变化中的最小粒子）\n• 原子可以结合成分子，也能直接构成物质\n• 金属（如金、铜）、稀有气体（氦、氖）、金刚石等由原子直接构成\n• 原子呈电中性（质子数=电子数）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "氢气和氧气反应生成水：在反应中，氢分子（H₂）和氧分子（O₂）分解为氢原子和氧原子，这些原子重新组合形成水分子（H₂O）。氢原子和氧原子本身没有变化，只是重新组合了。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "理解原子的概念有助于：1）理解化学变化的本质是原子的重新组合；2）解释质量守恒定律（反应前后原子种类和数目不变）；3）认识物质的多样性来源于不同的原子组合方式。",
                    "pattern_ref": "explanation/v2/application",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p115-atom-chemical-change"],
        },
        # ============================================
        # 2. 原子结构 (Atomic Structure)
        # ============================================
        {
            "node_id": "concept:atomic-structure",
            "title": "原子结构",
            "summary": "原子由位于中心的原子核和核外电子构成。原子核带正电，由质子和中子组成，体积极小但集中了原子的几乎全部质量。核外电子带负电，在原子核外的广大空间中高速运动。电子按能量高低分层排布，外层电子决定了原子的化学性质。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "原子由原子核和核外电子两部分构成。原子核位于原子中心，由质子和中子构成，带正电荷。核外电子在原子核外空间中围绕原子核做高速运动，带负电荷。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "原子结构体现了物质的层次性和电中性原理。原子核的稳定性与核外电子的活跃性形成对比，核外电子特别是最外层电子决定了原子的化学性质和相互作用方式。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 原子核位于原子中心，体积极小（约占原子体积的万分之一）\n• 原子核由质子和中子构成，带正电\n• 核外电子在广阔空间内高速运动\n• 原子呈电中性：质子数=电子数\n• 电子按能量高低分层排布",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "原子结构理论解释了：1）元素的化学性质由核外电子特别是最外层电子决定；2）化学键的形成是原子间电子的转移或共享；3）元素周期律的本质是核外电子排布的周期性变化。",
                    "pattern_ref": "explanation/v2/application",
                },
                {
                    "id": "misconception",
                    "title": "常见误解",
                    "content": "误解：原子中质子和电子像行星绕太阳一样在同一平面上运动。\n纠正：电子在核外空间中的运动没有确定的轨道，只能用概率云描述其出现的可能性，分层排布是能量高低的简化表示。",
                    "pattern_ref": "explanation/v2/misconception",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p116-atomic-structure-model"],
        },
        # ============================================
        # 3. 原子核 (Atomic Nucleus)
        # ============================================
        {
            "node_id": "concept:atomic-nucleus",
            "title": "原子核",
            "summary": "原子核位于原子的中心，由质子和中子构成，带有正电荷。原子核体积极小（约为原子体积的万分之一），但集中了原子的几乎全部质量。原子核所带的正电荷数（核电荷数）等于质子数，决定了元素的种类。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "原子核是原子的中心部分，由质子和中子构成，带正电荷。原子核的体积很小但密度极大，集中了原子的几乎全部质量。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "原子核是原子的质量中心和正电荷中心。它决定了元素的种类（由质子数决定）和同位素种类（由质子数和中子数共同决定），是原子稳定性的基础。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 原子核位于原子中心\n• 由质子和中子构成\n• 带正电荷（核电荷数=质子数）\n• 体积极小（约为原子体积的10^-15倍）\n• 质量极大（占原子质量的99.96%以上）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "如果把原子比作一座十层大楼那样大，那么原子核只相当于一粒绿豆般小。这形象地说明了原子核相对于整个原子来说体积极小，但质量高度集中。",
                    "pattern_ref": "explanation/v2/example",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p116-atomic-structure-model"],
        },
        # ============================================
        # 4. 质子 (Proton)
        # ============================================
        {
            "node_id": "concept:proton",
            "title": "质子",
            "summary": "质子是构成原子核的基本粒子之一，带有1个单位的正电荷。不同元素的原子核中质子数不同，质子数决定了元素的种类，因此也称为原子序数。质子数=核电荷数=核外电子数（在原子中）。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "质子是构成原子核的基本粒子之一，带1个单位的正电荷。质子数决定元素的种类。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 质子带1个单位正电荷\n• 质子数决定元素的种类\n• 在原子中：质子数=核电荷数=核外电子数\n• 质子质量约为1.67×10^-27 kg\n• 氢原子核只有一个质子，没有中子",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "不同原子的质子数：氢原子1个质子，碳原子6个质子，氧原子8个质子，钠原子11个质子。正是这些不同的质子数使它们成为不同的元素。",
                    "pattern_ref": "explanation/v2/example",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p116-particle-electrical-properties"],
        },
        # ============================================
        # 5. 中子 (Neutron)
        # ============================================
        {
            "node_id": "concept:neutron",
            "title": "中子",
            "summary": "中子是构成原子核的基本粒子之一，不带电荷（电中性），质量略大于质子。同种元素的原子质子数相同，但中子数可能不同（形成同位素）。中子数影响原子的质量，但不影响元素的化学性质。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "中子是构成原子核的基本粒子之一，不带电荷（电中性），质量略大于质子。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 中子不带电（电中性）\n• 质量略大于质子\n• 中子数影响原子质量但不影响化学性质\n• 同种元素可以有不同的中子数（同位素）\n• 氢原子通常没有中子",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "碳元素有碳-12（6个中子）和碳-14（8个中子）等同位素，它们的质子数都是6，化学性质相同，但质量不同，碳-14具有放射性。",
                    "pattern_ref": "explanation/v2/example",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p116-particle-electrical-properties"],
        },
        # ============================================
        # 6. 电子 (Electron)
        # ============================================
        {
            "node_id": "concept:electron",
            "title": "电子",
            "summary": "电子是带1个单位负电荷的微观粒子，质量约为质子质量的1/1836，在原子核外广阔的空间内高速运动。电子数等于质子数时，原子呈电中性。核外电子特别是最外层电子决定了原子的化学性质，参与化学反应。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "电子是带1个单位负电荷的微观粒子，在原子核外广阔的空间内围绕原子核做高速运动。电子的质量极小，约为质子质量的1/1836。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "电子是原子中活跃的、参与化学反应的粒子。外层电子的能量较高，容易得失，从而引发化学反应。电子的行为遵循量子力学规律，不能简单地用经典轨道描述。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 电子带1个单位负电荷\n• 质量极小（约为质子的1/1836）\n• 在核外广阔空间内高速运动\n• 电子数=质子数时原子呈电中性\n• 最外层电子决定化学性质",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "理解电子结构有助于：1）预测元素的化学性质；2）解释化合价的形成；3）理解化学键的本质；4）设计新型材料和药物。",
                    "pattern_ref": "explanation/v2/application",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p116-particle-electrical-properties"],
        },
        # ============================================
        # 7. 离子 (Ion)
        # ============================================
        {
            "node_id": "concept:ion",
            "title": "离子",
            "summary": "离子是带电的原子或原子团，由原子得失电子形成。失去电子形成带正电的正离子（阳离子），得到电子形成带负电的负离子（阴离子）。离子是构成物质的一种微观粒子（如氯化钠由钠离子和氯离子构成）。离子在溶液中或熔融状态下可以导电。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "离子是带电的原子或原子团。带正电荷的叫做正离子（如钠离子Na⁺），带负电荷的叫做负离子（如氯离子Cl⁻）。某些带电的原子团也是离子，通常称为某根，如碳酸根(CO₃²⁻)、氢氧根(OH⁻)、铵根(NH₄⁺)。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "离子的形成是原子趋向于稳定结构（最外层8电子或2电子）的过程。金属原子易失去电子形成阳离子，非金属原子易得到电子形成阴离子。离子之间通过静电作用形成离子键。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 离子是带电的原子或原子团\n• 正离子：失去电子（金属易形成）\n• 负离子：得到电子（非金属易形成）\n• 离子也是构成物质的一种粒子\n• 稳定结构：最外层8电子（或2电子）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "钠原子失去1个电子形成Na⁺（正离子），氯原子得到1个电子形成Cl⁻（负离子），Na⁺和Cl⁻通过静电作用结合形成NaCl（氯化钠）。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "1）理解离子化合物的性质（如溶解性、导电性）；2）电解质溶液导电的本质是离子的定向移动；3）生物体内的Na⁺、K⁺、Ca²⁺等离子对生命活动至关重要。",
                    "pattern_ref": "explanation/v2/application",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p117-ion-formation"],
        },
        # ============================================
        # 8. 电子层 (Electron Shell)
        # ============================================
        {
            "node_id": "concept:electron-shell",
            "title": "电子层",
            "summary": "电子层是核外电子按照能量高低在离核远近不同的区域的分层排布。离核最近的电子层为第一层（K层），由近及远依次为第二、三、四、五、六、七层（L、M、N、O、P、Q层）。最外层电子数决定化学性质，一般不超过8个（只有一层的不超过2个）。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "电子层是核外电子按照能量高低和离核远近的简化表示。离核最近的称为第一层（K层），其余由近及远依次为第二、三、四、五、六、七层（L、M、N、O、P、Q层），离核最远的常称为最外层。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 电子按能量高低分层排布\n• 第一层（K层）最多容纳2个电子\n• 其他层最多容纳8个电子（最外层）\n• 电子先填满内层再填外层\n• 稳定结构：最外层8电子（或只有一层时2电子）",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "氧原子结构：原子核内有8个质子，核外第一层（K层）有2个电子，第二层（L层，即最外层）有6个电子。最外层6电子未达到稳定结构，所以氧原子容易得到2个电子。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "电子层排布规律帮助我们：1）预测元素的化合价；2）判断元素的金属性或非金属性；3）理解元素周期律的排布依据；4）解释化学键的形成。",
                    "pattern_ref": "explanation/v2/application",
                },
                {
                    "id": "misconception",
                    "title": "常见误解",
                    "content": "误解：电子层的限制意味着每层绝对只能容纳8个电子。\n纠正：对于第二层及以上，虽然最外层一般不超过8个电子，但内层可以容纳更多电子（如第三层最多18个），这是由量子力学规律决定的。",
                    "pattern_ref": "explanation/v2/misconception",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p117-electron-shell"],
        },
        # ============================================
        # 9. 相对原子质量 (Relative Atomic Mass)
        # ============================================
        {
            "node_id": "concept:relative-atomic-mass",
            "title": "相对原子质量",
            "summary": "相对原子质量是以一个碳-12原子质量的1/12作为标准，任何原子的实际质量与该标准的比值。它是一个无量纲的比值，简化了原子的质量计算。相对原子质量≈质子数+中子数。相对分子质量是构成分子的各原子相对原子质量的总和。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "以一个碳-12原子质量的1/12作为标准，任何原子的实际质量与这个标准之间的比值，称为该原子的相对原子质量。它是一个无量纲的数值。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "相对原子质量建立了一个统一的质量比较标准，使极小的原子质量可以用方便的数值表示。它反映了原子核的质量（主要由质子和中子贡献）。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 标准：碳-12原子质量的1/12\n• 计算公式：Ar = 原子实际质量 / (碳-12质量 × 1/12)\n• 相对原子质量≈质子数+中子数\n• 是一个比值，单位为1（常省略）\n• 相对分子质量=各原子相对原子质量之和",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "氧原子的相对原子质量约为16：氧原子实际质量(2.656×10^-26 kg) ÷ (碳12原子质量1.993×10^-26 kg × 1/12) ≈ 16。氧原子有8个质子和8个中子，8+8=16。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "相对原子质量的应用：1）计算相对分子质量；2）化学方程式的定量计算；3）化学式中各元素质量比的计算；4）物质的量的计算。",
                    "pattern_ref": "explanation/v2/application",
                },
                {
                    "id": "misconception",
                    "title": "常见误解",
                    "content": "误解：相对原子质量就是原子的实际质量。\n纠正：相对原子质量是一个比值（单位为1），原子的实际质量单位是kg，两者完全不同。例如氧的相对原子质量约为16，但实际质量约为2.656×10^-26 kg。",
                    "pattern_ref": "explanation/v2/misconception",
                },
            ],
            "evidence_refs": [
                "evidence:3-5-1:p118-relative-atomic-mass",
                "evidence:3-5-1:p119-relative-molecular-mass",
            ],
        },
        # ============================================
        # 10. 核电荷数 (Nuclear Charge Number)
        # ============================================
        {
            "node_id": "concept:nuclear-charge",
            "title": "核电荷数",
            "summary": "核电荷数是原子核所带的正电荷数，等于原子核内的质子数。在原子中，核电荷数=质子数=核外电子数，由于正负电荷相等，整个原子呈电中性。核电荷数决定了元素的种类，是元素周期表中元素排序的依据。",
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "content": "原子核所带的正电荷数叫做核电荷数，等于原子核内的质子数。在原子中，核电荷数=质子数=核外电子数。",
                    "pattern_ref": "explanation/v2/definition",
                },
                {
                    "id": "essence",
                    "title": "核心本质",
                    "content": "核电荷数是原子的本质特征，它决定了元素的种类。不同元素有不同的核电荷数，这是元素分类的根本依据，也是元素周期律的基础。",
                    "pattern_ref": "explanation/v2/essence",
                },
                {
                    "id": "key-points",
                    "title": "关键要点",
                    "content": "• 核电荷数=质子数=原子核的正电荷数\n• 在原子中：核电荷数=质子数=核外电子数\n• 核电荷数决定元素的种类\n• 核电荷数=原子序数（元素周期表中的序号）\n• 阳离子：核电荷数>核外电子数",
                    "pattern_ref": "explanation/v2/key-points",
                },
                {
                    "id": "example",
                    "title": "示例",
                    "content": "氧原子有8个质子，所以核电荷数为8，在元素周期表中排在第8位（原子序数=8）。钠原子失去1个电子形成Na⁺后，核电荷数仍为11，但核外电子数变为10。",
                    "pattern_ref": "explanation/v2/example",
                },
                {
                    "id": "application",
                    "title": "应用",
                    "content": "核电荷数的应用：1）确定元素的种类；2）计算原子的电子数；3）理解元素周期表的排列规律；4）判断离子所带电荷数。",
                    "pattern_ref": "explanation/v2/application",
                },
            ],
            "evidence_refs": ["evidence:3-5-1:p116-nuclear-charge"],
        },
    ]

    success_count = 0
    for card in node_cards:
        if create_node_card(
            card["node_id"],
            card["title"],
            card["summary"],
            card["sections"],
            card["evidence_refs"],
        ):
            success_count += 1

    print(
        f"\n✅ Node card creation complete: {success_count}/{len(node_cards)} successful"
    )


if __name__ == "__main__":
    main()
