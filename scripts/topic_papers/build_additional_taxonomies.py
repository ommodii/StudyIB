from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config" / "curricula"


def topic(code: str, title: str, parent: str, level: list[str], terms: str, legacy: str = "") -> dict:
    phrases = [item.strip() for item in terms.split("|") if item.strip()]
    concepts = [title.lower()]
    return {
        "code": code,
        "title": title,
        "parent": parent,
        "level": level,
        "keywords": phrases,
        "concepts": concepts,
        "exclusions": [],
        "legacy_topic_mappings": [item.strip() for item in legacy.split("|") if item.strip()],
    }


def write(name: str, payload: dict) -> None:
    path = CONFIG / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def math_ai() -> dict:
    groups = {
        "1. Number and algebra": [
            ("1.1", "Scientific notation", "scientific notation|standard form|order of magnitude"),
            ("1.2", "Arithmetic sequences and series", "arithmetic sequence|arithmetic series|common difference|sigma notation|more than the previous day|constant amount each day"),
            ("1.3", "Geometric sequences and series", "geometric sequence|geometric series|common ratio|percentage of the previous day|distance travelled in the previous minute|increased by a percentage|bounces on the ground|maximum height reached after each bounce"),
            ("1.4", "Financial applications of geometric sequences", "compound interest|compounded quarterly|annual depreciation|financial application|investment growth|fixed deposit account"),
            ("1.5", "Integer exponents and logarithms", "integer exponent|base 10 logarithm|natural logarithm|laws of exponents"),
            ("1.6", "Approximation, estimation and percentage error", "approximation|estimate|percentage error|significant figure|upper bound|lower bound|measured correct to the nearest|maximum possible"),
            ("1.7", "Loans, amortization and annuities", "loan repayment|loan of|amortization|annuity|financial solver|monthly instalment|monthly installment|fixed monthly|outstanding balance|future value|deposits an additional|invest each year"),
            ("1.8", "Technology solutions of equations", "solve using technology|system of linear equations|polynomial equation|simultaneous equations|write down three equations|number of each type"),
            ("1.9", "Laws of logarithms", "laws of logarithms|change of base|logarithmic equation"),
            ("1.10", "Rational exponents", "rational exponent|non-integer exponent|fractional exponent"),
            ("1.11", "Infinite geometric sequences", "infinite geometric|sum to infinity|convergent geometric"),
            ("1.12", "Complex numbers in Cartesian form", "complex number|cartesian form|complex conjugate|imaginary part|argand"),
            ("1.13", "Complex numbers in polar and Euler form", "polar form|modulus-argument|euler form|cis|complex plane|total voltage in the circuit|time of sunrise|time of sunset|same frequency"),
            ("1.14", "Matrices and systems of equations", "matrix|determinant|inverse matrix|identity matrix|matrix multiplication"),
            ("1.15", "Eigenvalues and eigenvectors", "eigenvalue|eigenvector|characteristic polynomial|diagonalization|diagonalisation"),
        ],
        "2. Functions": [
            ("2.1", "Equations of straight lines", "straight line|gradient|y-intercept|parallel lines|perpendicular lines"),
            ("2.2", "Function concepts, domain and range", "domain|range|function notation|inverse function|function as a model"),
            ("2.3", "Graphs of functions", "graph of a function|sketch the graph|graphing technology"),
            ("2.4", "Key features and intersections of graphs", "point of intersection|graphs intersect|intersect at|key features of a graph|zeros|maximum point|minimum point"),
            ("2.5", "Modelling with common functions", "linear model|quadratic model|exponential model|cubic model|sinusoidal model|direct variation|inverse variation|height can be modelled|temperature could be modelled|could be modelled by the following function|can be modelled by|amplitude of the function|modelled by the function|modeled by the function|modelled the percentage|modeled the percentage"),
            ("2.6", "The modelling cycle", "develop a model|fit a model|test the model|model validity|reasonable domain|limitations of the model"),
            ("2.7", "Composite and inverse functions", "composite function|inverse function|domain restriction|f(g(x))"),
            ("2.8", "Transformations of graphs", "transformation of graph|translation|translated by|reflection|vertical stretch|horizontal stretch|let g(x)|draw the graph of y = g"),
            ("2.9", "Advanced function models", "logistic model|piecewise model|non-linear model|model parameter|least squares"),
            ("2.10", "Scaling and linearization", "log-log graph|semi-log graph|linearization|linearisation|scaling large numbers|power model|classified by their brightness|star visible without magnification|magnitude of another star"),
        ],
        "3. Geometry and trigonometry": [
            ("3.1", "Three-dimensional geometry and measurement", "three-dimensional|surface area|volume|midpoint|distance between two points"),
            ("3.2", "Right and non-right triangle trigonometry", "sine rule|cosine rule|right-angled triangle|area of a triangle|pythagoras"),
            ("3.3", "Applications of trigonometry", "angle of elevation|angle of depression|looks upward at an angle|bearing|labelled diagram"),
            ("3.4", "Circles, arcs and sectors", "arc length|area of a sector|circle geometry|sector area"),
            ("3.5", "Intersections and perpendicular bisectors", "perpendicular bisector|intersection of lines|equidistant point"),
            ("3.6", "Voronoi diagrams", "voronoi|nearest neighbour|nearest neighbor|site point|cell boundary"),
            ("3.7", "Radian measure", "radian|radian measure|arc length in radians|sector in radians"),
            ("3.8", "Unit circle and trigonometric equations", "unit circle|pythagorean identity|trigonometric equation|periodic solution"),
            ("3.9", "Matrix transformations", "transformation matrix|geometric transformation|image of the point|rotation matrix|reflection matrix|enlargement matrix"),
            ("3.10", "Vectors and vector operations", "vector|position vector|displacement vector|magnitude of a vector|unit vector"),
            ("3.11", "Vector equations of lines", "vector equation of a line|two lines l 1 and l 2|lines intersect|angle between two lines|intersection of vector lines|direction vector|line along which it travels"),
            ("3.12", "Vector applications to kinematics", "vector kinematics|velocity vector|acceleration vector|position vector"),
            ("3.13", "Scalar and vector products", "scalar product|dot product|vector product|cross product|perpendicular vectors|hence find the area of the triangle"),
            ("3.14", "Graph theory", "graph theory|vertex|edge|degree of a vertex|connected graph|weighted graph"),
            ("3.15", "Adjacency matrices and tables", "adjacency matrix|adjacency table|walk in a graph|subgraph"),
            ("3.16", "Graph algorithms and route optimization", "minimum spanning tree|kruskal|prim's algorithm|chinese postman|travelling salesman|traveling salesman|nearest neighbour algorithm"),
        ],
        "4. Statistics and probability": [
            ("4.1", "Populations, samples and data", "population|sample|random sample|discrete data|continuous data|sampling bias"),
            ("4.2", "Presentation of data", "frequency table|histogram|cumulative frequency|box plot|box-and-whisker"),
            ("4.3", "Measures of central tendency and dispersion", "mean|median|mode|standard deviation|variance|interquartile range"),
            ("4.4", "Linear correlation and regression", "pearson|correlation coefficient|scatter diagram|regression line|line of best fit"),
            ("4.5", "Probability concepts", "sample space|relative frequency|complementary event|expected number of occurrences"),
            ("4.6", "Combined and conditional probability", "venn diagram|tree diagram|conditional probability|either the arts programme or the sciences programme|telling the truth or not|mutually exclusive|independent events"),
            ("4.7", "Discrete random variables", "discrete random variable|probability distribution|expected value|game is fair|probability of knocking over"),
            ("4.8", "Binomial distribution", "binomial distribution|binomial probability|mean of a binomial|variance of a binomial"),
            ("4.9", "Normal distribution", "normal distribution|normal curve|inverse normal|normal probability"),
            ("4.10", "Spearman rank correlation", "spearman|rank correlation|ranked data"),
            ("4.11", "Chi-square tests", "chi-square|chi squared|goodness of fit|test for independence|expected frequency"),
            ("4.12", "Data collection and reliability", "reliability|validity|sampling technique|outlier|data collection"),
            ("4.13", "Non-linear regression", "non-linear regression|nonlinear regression|coefficient of determination|residual plot"),
            ("4.14", "Linear transformations of random variables", "linear transformation of a random variable|unbiased estimator|expectation of|variance of"),
            ("4.15", "Central limit theorem", "central limit theorem|sample mean distribution|sampling distribution"),
            ("4.16", "Confidence intervals", "confidence interval|confidence level|population mean|population proportion"),
            ("4.17", "Poisson distribution", "poisson distribution|poisson process|poisson probability"),
            ("4.18", "Hypothesis tests and errors", "hypothesis test|t-test|z-test|type i error|type ii error|p-value|significance level"),
            ("4.19", "Transition matrices and Markov chains", "transition matrix|markov chain|steady state|state vector|transition diagram"),
        ],
        "5. Calculus": [
            ("5.1", "Limits and rates of change", "limit|rate of change|gradient function|derivative interpreted"),
            ("5.2", "Increasing and decreasing functions", "increasing function|decreasing function|derivative positive|derivative negative"),
            ("5.3", "Derivatives of power functions", "differentiate|derivative|power rule|gradient function"),
            ("5.4", "Tangents and normals", "tangent|normal to the curve|equation of the normal|equation of the tangent"),
            ("5.5", "Introduction to integration", "anti-differentiation|antiderivative|definite integral|area under the curve"),
            ("5.6", "Stationary points", "stationary point|local maximum|local minimum|turning point"),
            ("5.7", "Optimization", "optimization|optimisation|maximize|minimize|maximum volume|minimum cost|minimize the area|minimum area|minimum possible area"),
            ("5.8", "Trapezoidal rule", "trapezoidal rule|trapezium rule|numerical area"),
            ("5.9", "Derivative rules and standard functions", "chain rule|product rule|quotient rule|derivative of sine|derivative of exponential|derivative of logarithm"),
            ("5.10", "Second derivatives and classification", "second derivative|second derivative test|point of inflexion|concavity"),
            ("5.11", "Advanced integration methods", "indefinite integral|reverse chain rule|integration by substitution|substitution in integration"),
            ("5.12", "Areas and volumes of revolution", "area between curves|volume of revolution|rotation about the x-axis|rotation about the y-axis|rotating the graph|calculate its volume"),
            ("5.13", "Kinematics", "displacement|velocity|acceleration|total distance travelled|kinematic"),
            ("5.14", "Separable differential equations", "differential equation|separation of variables|separable"),
            ("5.15", "Slope fields", "slope field|direction field|isocline|solution curve"),
            ("5.16", "Euler's method for first-order equations", "euler's method|euler method|first-order differential equation|numerical solution"),
            ("5.17", "Phase portraits", "phase portrait|phase plane|equilibrium point|trajectory"),
            ("5.18", "Euler's method for second-order equations", "second-order differential equation|euler method for second order|coupled first-order equations"),
        ],
    }
    topics = []
    for parent, rows in groups.items():
        for number, title, terms in rows:
            level = ["SL", "HL"] if int(number.split(".")[1]) <= {"1": 8, "2": 6, "3": 6, "4": 9, "5": 8}[number[0]] else ["HL"]
            topics.append(topic(f"AI {number}", title, parent, level, terms))
    exclusions = {
        "AI 1.6": ["voronoi diagram", "probability distribution", "minimum spanning tree", "lower bound for the travelling time"],
        "AI 2.1": ["direction vector", "slope field", "differential equation", "voronoi diagram", "volume of revolution", "calculate its volume"],
        "AI 2.2": ["modelled the percentage", "modeled the percentage"],
        "AI 2.4": ["slope field", "differential equation"],
        "AI 3.2": ["minimize the area", "cross product"],
        "AI 3.1": ["differential equation"],
        "AI 3.10": ["position vector when", "velocity vector", "acceleration vector"],
        "AI 3.14": ["voronoi diagram", "adjacency matrix", "minimum spanning tree", "chinese postman", "travelling salesman"],
        "AI 4.3": ["poisson distribution", "normal distribution", "random variable"],
        "AI 1.14": ["adjacency matrix", "adjacency table", "transition matrix", "markov chain"],
        "AI 5.6": ["slope field", "differential equation"],
        "AI 5.14": ["slope field"],
        "AI 4.1": ["differential equation", "phase portrait"],
    }
    for item in topics:
        item["exclusions"] = exclusions.get(item["code"], [])
    return {
        "subject": "mathematics",
        "course": "ai",
        "curriculum_version": "DP Mathematics: applications and interpretation, first assessment 2021 (current through 2028)",
        "first_assessment": 2021,
        "sources": [{"title": "IB Mathematics: applications and interpretation guide", "url": "https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/mathematics-applications-interpretation-guide.pdf"}],
        "topics": topics,
    }


def business() -> dict:
    groups = {
        "Unit 1. Introduction to business management": [
            ("1.1", "What is a business?", "business activity|business sector|primary sector|secondary sector|tertiary sector|entrepreneurship|starting the business|start a business", "nature of business activity"),
            ("1.2", "Types of business entities", "sole trader|partnership|private limited|public limited|cooperative|social enterprise|franchise|microfinance provider", "types of organizations|types of organisation"),
            ("1.3", "Business objectives", "business objective|mission statement|vision statement|ethical objective|ethical issue|ethical issues|business ethics|ethics on organizational strategy|ethics on organisational strategy|ethics on organizational change|ethics on organisational change|organizational ethics|organisational ethics|corporate social responsibility|csr", "organizational objectives|organisation objectives"),
            ("1.4", "Stakeholders", "stakeholder|shareholder|stakeholder conflict|internal stakeholder|external stakeholder", "stakeholders"),
            ("1.5", "Growth and evolution", "economies of scale|diseconomies of scale|organic growth|internal growth|external growth|merger|acquisition|joint venture|strategic alliance", "organizational growth and evolution|globalization"),
            ("1.6", "Multinational companies", "multinational company|multinational corporation|mnc|foreign direct investment|global company", "multinational companies"),
        ],
        "Unit 2. Human resource management": [
            ("2.1", "Introduction to human resource management", "human resource management|human resource planning|workforce planning|recruitment|training|dismissal|dismiss|redundancy|labour turnover", "human resource planning"),
            ("2.2", "Organizational structure", "organizational structure|organisation structure|span of control|chain of command|delegation|centralization|decentralization|matrix structure", "organizational structure"),
            ("2.3", "Leadership and management", "leadership style|autocratic|democratic|paternalistic|laissez-faire|management style|functions of management", "leadership and management"),
            ("2.4", "Motivation and demotivation", "motivation|demotivation|maslow|herzberg|taylor|non-financial reward|financial reward", "motivation"),
            ("2.5", "Organizational culture", "organizational culture|organisation culture|culture clash|cultural change|culture can promote|culture can inhibit|culture on organizational ethics|culture on organisational ethics|impact of culture", "organizational culture"),
            ("2.6", "Communication", "communication|communication barrier|formal communication|informal communication|communication method", "communication"),
            ("2.7", "Industrial and employee relations", "industrial relations|employee relations|trade union|collective bargaining|industrial action|strike|conciliation|arbitration", "industrial/employee relations"),
        ],
        "Unit 3. Finance and accounts": [
            ("3.1", "Introduction to finance", "finance function|financial objective|capital expenditure|revenue expenditure", "sources of finance"),
            ("3.2", "Sources of finance", "source of finance|external finance|share capital|loan capital|overdraft|trade credit|venture capital|retained profit|leasing", "sources of finance"),
            ("3.3", "Costs and revenues", "fixed cost|variable cost|total cost|revenue|contribution|contribution per unit", "costs and revenues"),
            ("3.4", "Final accounts", "profit and loss account|income statement|balance sheet|statement of financial position|gross profit|net profit|depreciation", "final accounts"),
            ("3.5", "Profitability and liquidity ratio analysis", "gross profit margin|profit margin|return on capital employed|current ratio|acid test ratio|liquidity ratio", "profitability and liquidity ratio analysis"),
            ("3.6", "Debt and equity ratio analysis", "gearing ratio|debt to equity|debt-equity ratio|highly geared|debt finance", "efficiency ratio analysis"),
            ("3.7", "Cash flow", "cash flow|cash-flow forecast|cash inflow|cash outflow|working capital|cash shortage", "cash flow"),
            ("3.8", "Investment appraisal", "payback period|average rate of return|arr|net present value|npv|discounted cash flow", "investment appraisal"),
            ("3.9", "Budgets", "budget|variance analysis|favourable variance|adverse variance|cost centre|profit centre", "budgets"),
        ],
        "Unit 4. Marketing": [
            ("4.1", "Introduction to marketing", "market orientation|product orientation|market share|market growth|commercial marketing|social marketing|unique selling point|usp", "the role of marketing"),
            ("4.2", "Marketing planning", "marketing plan|marketing strategy|marketing strategies|marketing objective|segmentation|target market|positioning|market map|marketing mix", "marketing planning"),
            ("4.3", "Sales forecasting", "sales forecast|moving average|seasonal variation|trend line|extrapolation", "sales forecasting"),
            ("4.4", "Market research", "market research|primary research|secondary research|questionnaire|focus group|sampling method|methods of sampling", "market research"),
            ("4.5", "The seven Ps of the marketing mix", "product life cycle|branding|pricing strategy|promotion|place|people|process|physical evidence|seven ps|marketing mix", "the four Ps|marketing mix"),
            ("4.6", "International marketing", "international marketing|global marketing|standardization|standardisation|adaptation strategy|cultural difference", "international marketing|e-commerce"),
        ],
        "Unit 5. Operations management": [
            ("5.1", "Introduction to operations management", "operations management|production process|inputs outputs|added value|sustainability", "the role of operations management"),
            ("5.2", "Operations methods", "job production|customized production|customised production|batch production|mass production|cell production|labour intensive|capital intensive", "production methods"),
            ("5.3", "Lean production and quality management", "lean production|just in time|jit|kaizen|quality control|quality assurance|total quality management|tqm", "lean production and quality management"),
            ("5.4", "Location", "location decision|two possible locations|relocate|re-location|offshoring|reshoring|outsourcing|outsource|location factor", "location"),
            ("5.5", "Break-even analysis", "break-even|breakeven|margin of safety|contribution|break-even chart", "break-even analysis"),
            ("5.6", "Production planning", "capacity utilization|capacity utilisation|stock control|inventory control|buffer stock|lead time|productivity", "production planning"),
            ("5.7", "Crisis management and contingency planning", "crisis management|contingency planning|business continuity|crisis response", "crisis management and contingency planning"),
            ("5.8", "Research and development", "research and development|r&d|innovation|intellectual property|patent|copyright", "research and development"),
            ("5.9", "Management information systems", "management information system|mis|data analytics|database|cybersecurity|information technology", "management information systems"),
        ],
    }
    topics = [topic(f"BM {n}", title, parent, ["HL"] if n in {"2.5", "2.7", "3.6", "3.9", "4.3", "4.6", "5.3", "5.6", "5.7", "5.8", "5.9"} else ["SL", "HL"], terms, legacy) for parent, rows in groups.items() for n, title, terms, legacy in rows]
    return {"subject": "business", "course": None, "curriculum_version": "DP Business management, first assessment 2024 with legacy mapping from the 2016 course", "first_assessment": 2024, "sources": [{"title": "IB Business management guide", "url": "https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/subject-guides/business-management-guide.pdf"}], "topics": topics}


def economics() -> dict:
    groups = {
        "Unit 1. Introduction to economics": [
            ("1.1", "What is economics?", "scarcity|choice|choices have to be made|production possibilities curve|ppc|opportunity cost|factors of production|economic well-being|economic wellbeing", "foundations of economics"),
            ("1.2", "How do economists approach the world?", "economic model|positive economics|normative economics|ceteris paribus|economic assumption|economic methodology", "foundations of economics"),
        ],
        "Unit 2. Microeconomics": [
            ("2.1", "Demand", "demand|law of demand|demand curve|change in demand|consumer surplus", "competitive markets: demand and supply"),
            ("2.2", "Supply", "supply|law of supply|supply curve|change in supply|producer surplus", "competitive markets: demand and supply"),
            ("2.3", "Competitive market equilibrium", "market equilibrium|equilibrium price|equilibrium quantity|excess demand|excess supply|price mechanism", "competitive markets: demand and supply"),
            ("2.4", "Critique of maximizing behaviour", "utility maximization|profit maximization|bounded rationality|behavioural economics|behavioral economics|bias", "theory of the firm"),
            ("2.5", "Elasticity of demand", "price elasticity of demand|income elasticity of demand|cross elasticity of demand|ped|yed|xed", "elasticities"),
            ("2.6", "Elasticity of supply", "price elasticity of supply|pes|elastic supply|inelastic supply", "elasticities"),
            ("2.7", "Government intervention in microeconomics", "indirect tax|tax the consumption|subsidy|subsidies|subsidize|subsidise|price ceiling|price floor|price floors|minimum price|maximum price|government regulation|government regulations|government intervention", "government intervention"),
            ("2.8", "Externalities and common access resources", "externality|external cost|external benefit|external benefits|private benefit|private benefits|social cost|social benefit|common access resource|overuse of common access|tragedy of the commons", "market failure"),
            ("2.9", "Public goods", "public good|non-rivalrous|non-excludable|free rider", "market failure"),
            ("2.10", "Asymmetric information", "asymmetric information|adverse selection|moral hazard|signalling|screening", "market failure"),
            ("2.11", "Market power", "monopoly|oligopoly|oligopolistic|monopolistic competition|perfect competition|market power|non-price competition|barriers to entry|long-run average total cost|marginal product|marginal cost|productive efficiency|price discrimination|collusion|collude", "theory of the firm and market structures"),
            ("2.12", "Market inability to achieve equity", "equity|income redistribution|inequality|fairness|progressive tax", "market failure|equity"),
        ],
        "Unit 3. Macroeconomics": [
            ("3.1", "Measuring economic activity", "gross domestic product|gdp|gross national income|gni|national income statistics|standard of living|circular flow|injections and leakages|nominal gdp|real gdp|business cycle", "measuring national income"),
            ("3.2", "Variations in economic activity: aggregate demand and supply", "aggregate demand|aggregate supply|ad-as|ad as|short-run aggregate supply|long-run aggregate supply|output gap", "aggregate demand and aggregate supply"),
            ("3.3", "Macroeconomic objectives", "economic growth|unemployment|inflation|deflation|price stability|full employment", "macroeconomic objectives"),
            ("3.4", "Economics of inequality and poverty", "lorenz curve|gini coefficient|poverty|income inequality|wealth inequality|poverty cycle", "inequality and poverty"),
            ("3.5", "Monetary policy", "monetary policy|interest rate|money supply|central bank|quantitative easing|exchange rate intervention", "demand-side policies: monetary policy"),
            ("3.6", "Fiscal policy", "fiscal policy|government spending|taxation|budget deficit|budget surplus|public debt", "demand-side policies: fiscal policy"),
            ("3.7", "Supply-side policies", "supply-side policy|market-based policy|interventionist policy|labour market reform|infrastructure spending|deregulation", "supply-side policies"),
        ],
        "Unit 4. The global economy": [
            ("4.1", "Benefits of international trade", "international trade|comparative advantage|absolute advantage|gains from trade|trade liberalization", "international trade"),
            ("4.2", "Types of trade protection", "tariff|quota|subsidy|administrative barrier|trade protection|protectionism", "trade protection"),
            ("4.3", "Arguments for and against trade protection", "infant industry|dumping|domestic employment|national security|arguments for protection", "trade protection"),
            ("4.4", "Economic integration", "free trade area|customs union|common market|monetary union|economic integration|trading bloc", "economic integration"),
            ("4.5", "Exchange rates", "exchange rate|currency appreciation|currency depreciation|fixed exchange rate|floating exchange rate|managed exchange rate", "exchange rates"),
            ("4.6", "Balance of payments", "balance of payments|current account|capital account|financial account|current account deficit|current account surplus", "balance of payments"),
            ("4.7", "Sustainable development", "sustainable development|sustainability|environmental sustainability|sustainable development goal|sdg", "economic development"),
            ("4.8", "Measuring development", "human development index|hdi|development indicator|gni per capita|multidimensional poverty index", "measuring development"),
            ("4.9", "Barriers to economic growth and development", "poverty trap|barrier to development|corruption|capital flight|indebtedness|institutional factor", "barriers to economic development"),
            ("4.10", "Economic growth and development strategies", "development strategy|foreign aid|microfinance|foreign direct investment|fdi|export promotion|import substitution|market-oriented strategy", "development strategies"),
        ],
    }
    topics = [topic(f"ECON {n}", title, parent, ["SL", "HL"], terms, legacy) for parent, rows in groups.items() for n, title, terms, legacy in rows]
    exclusions = {
        "ECON 2.1": ["aggregate demand"],
        "ECON 2.2": ["aggregate supply"],
        "ECON 2.12": ["income inequality", "lorenz curve", "gini coefficient", "poverty"],
        "ECON 3.1": ["human development index", "gni per capita"],
    }
    for item in topics:
        item["exclusions"] = exclusions.get(item["code"], [])
    return {"subject": "economics", "course": None, "curriculum_version": "DP Economics, first assessment 2022 with legacy mapping from the 2013 course", "first_assessment": 2022, "sources": [{"title": "IB Economics subject brief", "url": "https://www.ibo.org/globalassets/new-structure/programmes/dp/pdfs/hl-economics-en.pdf"}], "topics": topics}


def computer_science() -> dict:
    groups = {
        "A. Concepts of computer science": [
            ("A.1", "Computer fundamentals", "computer architecture|computer organization|computer organisation|cpu|central processing unit|processor|register|memory address register|memory data register|program counter|instruction register|cache memory|ram|rom|primary memory|secondary storage|binary|hexadecimal|logic gate|truth table|operating system|system software|utility software|compiler|interpreter|interrupt|scheduling|paging|virtual memory|distributed system|embedded system|human computer interaction|usability|system fundamentals|planning a new computing system|planning a new system|system development life cycle|system life cycle|feasibility study|requirements specification|data collection method|observation|interview|questionnaire|changeover|direct changeover|parallel running|user training|colour representation|color representation|colour can be represented|color can be represented|polling|sensor|control system|integrated system|autonomous agent|autonomous agents|social implication|ethical implication"),
            ("A.2", "Networks", "computer network|network topology|local area network|wide area network|lan|wan|router|switch|packet|protocol|tcp|ip address|mac address|domain name system|dns|client server|peer to peer|p2p|wireless network|encryption|firewall|network security|internet|world wide web|network fundamentals|cloud computing|cyber security|cybersecurity|computer security|data security|security concern|security measure|threat landscape|whitelisting|zero-day|man-in-the-middle|cyber-criminal|malware|computer virus|phishing|authentication|authorization|authorisation|access control|bring your own device|byod|social networking|intellectual property|web|search engine|web crawler|page ranking|hits algorithm|compression technique|distributed systems|virtual private network|vpn|global positioning system|gps|voice over ip|voip|osi model|near field communication|nfc|radio frequency identification|rfid|interoperability|qr code"),
            ("A.3", "Databases", "database|database management system|dbms|relational database|table|record|field|primary key|foreign key|candidate key|normalization|normalisation|first normal form|second normal form|third normal form|sql|structured query language|entity relationship diagram|data redundancy|data integrity|transaction|query|schema|data warehouse|data warehousing|etl process|extract transform load|data mining|association rule|deviation detection"),
            ("A.4", "Machine learning", "machine learning|artificial intelligence|neural network|training data|supervised learning|unsupervised learning|reinforcement learning|classification model|regression model|bias in data|overfitting|underfitting|feature extraction|inference model"),
        ],
        "B. Computational thinking and problem-solving": [
            ("B.1", "Computational thinking", "computational thinking|decomposition|abstraction|pattern recognition|algorithmic thinking|flowchart|pseudocode|trace table|dry run|algorithm|linear search|binary search|bubble sort|selection sort|insertion sort|efficiency|complexity|big o|recursion|recursive|decision table|state transition|modelling|modeling|simulation|visualization|visualisation|rendering|wire frame|wireframe|computer-aided design|computer aided design|cad|3d view|2d view|graphics"),
            ("B.2", "Programming", "programming|program code|source code|computer language|programming language|variable|constant|assignment|selection|iteration|loop|while loop|for loop|array|two dimensional array|string|subprogram|procedure|function|parameter|return value|scope|exception|file handling|testing|test data|debugging|syntax error|logic error|runtime error|java|python"),
            ("B.3", "Object-oriented programming (OOP)", "object oriented|object-oriented|oop|class|object|instance|attribute|method|constructor|encapsulation|inheritance|polymorphism|aggregation|association|dependency|uml|unified modeling language|unified modelling language|public method|private method|static method"),
            ("B.4", "Abstract data types", "abstract data type|adt|stack|queue|linked list|binary tree|binary search tree|tree traversal|graph|hash table|heap|node|pointer|push|pop|enqueue|dequeue|fifo|lifo|inorder|preorder|postorder|data structure|dynamic data structure"),
        ],
    }
    topics = [
        topic(f"CS {code}", title, parent, ["SL", "HL"] if code != "B.4" else ["HL"], terms)
        for parent, rows in groups.items()
        for code, title, terms in rows
    ]
    exclusions = {
        "CS A.1": ["primary key", "foreign key", "machine learning"],
        "CS A.2": ["neural network"],
        "CS B.2": ["object oriented", "object-oriented", "abstract data type"],
        "CS B.3": ["database object", "linked list", "stack", "queue", "binary tree", "web graph", "semantic web", "folksonomy"],
    }
    for item in topics:
        item["exclusions"] = exclusions.get(item["code"], [])
    return {
        "subject": "computer_science",
        "course": None,
        "curriculum_version": "DP Computer science, first assessment 2027 with legacy mapping from the 2014 course",
        "first_assessment": 2027,
        "sources": [{
            "title": "IB Computer science subject brief",
            "url": "https://www.ibo.org/globalassets/new-structure/university-admission/pdfs/dp_comp_sci_subjectbrief_en.pdf",
        }],
        "topics": topics,
    }


def main() -> None:
    write("mathematics_ai.json", math_ai())
    write("business.json", business())
    write("economics.json", economics())
    write("computer_science.json", computer_science())


if __name__ == "__main__":
    main()
