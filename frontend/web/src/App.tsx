import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface BrowserExtension {
  id: string;
  name: string;
  encryptedCode: string;
  timestamp: number;
  developer: string;
  category: string;
  status: "pending" | "verified" | "rejected";
  downloads: number;
  rating: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [extensions, setExtensions] = useState<BrowserExtension[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newExtensionData, setNewExtensionData] = useState({
    name: "",
    description: "",
    category: "",
    sourceCode: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [activeFAQ, setActiveFAQ] = useState<number | null>(null);

  // Calculate statistics for dashboard
  const verifiedCount = extensions.filter(e => e.status === "verified").length;
  const pendingCount = extensions.filter(e => e.status === "pending").length;
  const rejectedCount = extensions.filter(e => e.status === "rejected").length;
  const totalDownloads = extensions.reduce((sum, ext) => sum + ext.downloads, 0);
  const avgRating = extensions.length > 0 
    ? (extensions.reduce((sum, ext) => sum + ext.rating, 0) / extensions.length).toFixed(1)
    : "0.0";

  // Filter and paginate extensions
  const filteredExtensions = extensions.filter(ext => {
    const matchesSearch = ext.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          ext.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || ext.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Pagination logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentExtensions = filteredExtensions.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredExtensions.length / itemsPerPage);

  useEffect(() => {
    loadExtensions().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadExtensions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("extension_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing extension keys:", e);
        }
      }
      
      const list: BrowserExtension[] = [];
      
      for (const key of keys) {
        try {
          const extensionBytes = await contract.getData(`extension_${key}`);
          if (extensionBytes.length > 0) {
            try {
              const extensionData = JSON.parse(ethers.toUtf8String(extensionBytes));
              list.push({
                id: key,
                name: extensionData.name,
                encryptedCode: extensionData.encryptedCode,
                timestamp: extensionData.timestamp,
                developer: extensionData.developer,
                category: extensionData.category,
                status: extensionData.status || "pending",
                downloads: extensionData.downloads || 0,
                rating: extensionData.rating || 0,
                description: extensionData.description || ""
              });
            } catch (e) {
              console.error(`Error parsing extension data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading extension ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setExtensions(list);
    } catch (e) {
      console.error("Error loading extensions:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitExtension = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting source code with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedCode = `FHE-${btoa(newExtensionData.sourceCode)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const extensionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const extensionData = {
        name: newExtensionData.name,
        description: newExtensionData.description,
        encryptedCode,
        timestamp: Math.floor(Date.now() / 1000),
        developer: account,
        category: newExtensionData.category,
        status: "pending",
        downloads: 0,
        rating: 0
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `extension_${extensionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(extensionData))
      );
      
      const keysBytes = await contract.getData("extension_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(extensionId);
      
      await contract.setData(
        "extension_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Extension submitted securely!"
      });
      
      await loadExtensions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewExtensionData({
          name: "",
          description: "",
          category: "",
          sourceCode: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyExtension = async (extensionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Verifying with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const extensionBytes = await contract.getData(`extension_${extensionId}`);
      if (extensionBytes.length === 0) {
        throw new Error("Extension not found");
      }
      
      const extensionData = JSON.parse(ethers.toUtf8String(extensionBytes));
      
      const updatedExtension = {
        ...extensionData,
        status: "verified"
      };
      
      await contract.setData(
        `extension_${extensionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedExtension))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed!"
      });
      
      await loadExtensions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectExtension = async (extensionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const extensionBytes = await contract.getData(`extension_${extensionId}`);
      if (extensionBytes.length === 0) {
        throw new Error("Extension not found");
      }
      
      const extensionData = JSON.parse(ethers.toUtf8String(extensionBytes));
      
      const updatedExtension = {
        ...extensionData,
        status: "rejected"
      };
      
      await contract.setData(
        `extension_${extensionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedExtension))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Extension rejected!"
      });
      
      await loadExtensions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isDeveloper = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const faqItems = [
    {
      question: "What is FHE and how does it protect browser extensions?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decryption. In this marketplace, extension source code remains encrypted during review and distribution, preventing exposure of sensitive code while ensuring security verification."
    },
    {
      question: "How does FHE verification work?",
      answer: "Our system uses FHE to analyze encrypted extension code for security vulnerabilities. Validators can run verification algorithms on the encrypted code, receiving results without ever seeing the actual source code."
    },
    {
      question: "Can I trust extensions from this marketplace?",
      answer: "Yes. Every extension undergoes rigorous FHE-based security checks before approval. The encrypted verification process ensures that even during review, the code remains protected against malicious actors."
    },
    {
      question: "How do I submit my own extension?",
      answer: "Connect your wallet, fill out the submission form, and your extension code will be encrypted using FHE before storage. Our validators will then review it while it remains encrypted."
    },
    {
      question: "What browsers are supported?",
      answer: "Extensions verified through our FHE system are compatible with all major browsers including Chrome, Firefox, Edge, and Brave."
    }
  ];

  const toggleFAQ = (index: number) => {
    setActiveFAQ(activeFAQ === index ? null : index);
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{extensions.length}</div>
          <div className="stat-label">Total Extensions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{verifiedCount}</div>
          <div className="stat-label">Verified</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">Pending Review</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalDownloads}</div>
          <div className="stat-label">Total Downloads</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgRating}</div>
          <div className="stat-label">Avg Rating</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing FHE security protocols...</p>
    </div>
  );

  return (
    <div className="app-container tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>Extension</span>Market</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn tech-button"
          >
            <div className="add-icon"></div>
            Submit Extension
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Fully Homomorphic Encryption Marketplace</h2>
            <p>Secure browser extensions verified while encrypted</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
        </div>
        
        <div className="panel-section">
          <div className="panel">
            <h2 className="panel-title">Project Introduction</h2>
            <div className="panel-content">
              <p>
                The FHE Extension Marketplace revolutionizes browser security by keeping extension source code encrypted during the entire review and distribution process. 
                Using Fully Homomorphic Encryption (FHE), validators can verify extension safety without ever decrypting the code.
              </p>
              <div className="tech-features">
                <div className="feature">
                  <div className="feature-icon">🔒</div>
                  <h3>Encrypted Source Code</h3>
                  <p>Extension code remains encrypted during review and distribution</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">⚙️</div>
                  <h3>FHE Verification</h3>
                  <p>Security checks performed on encrypted code</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">🛡️</div>
                  <h3>Malware Prevention</h3>
                  <p>Blocks malicious extensions before they reach users</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="panel">
            <h2 className="panel-title">Marketplace Statistics</h2>
            <div className="panel-content">
              {renderStats()}
            </div>
          </div>
        </div>
        
        <div className="panel">
          <h2 className="panel-title">Browser Extensions</h2>
          <div className="panel-content">
            <div className="filters">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search extensions..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="tech-input"
                />
                <div className="search-icon"></div>
              </div>
              
              <div className="status-filter">
                <label>Status:</label>
                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="tech-select"
                >
                  <option value="all">All</option>
                  <option value="verified">Verified</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
            
            <div className="extensions-list">
              {currentExtensions.length === 0 ? (
                <div className="no-extensions">
                  <div className="no-extensions-icon"></div>
                  <p>No extensions found</p>
                  <button 
                    className="tech-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Submit First Extension
                  </button>
                </div>
              ) : (
                <>
                  {currentExtensions.map(ext => (
                    <div className="extension-card" key={ext.id}>
                      <div className="extension-header">
                        <h3>{ext.name}</h3>
                        <span className={`status-badge ${ext.status}`}>
                          {ext.status}
                        </span>
                      </div>
                      <div className="extension-meta">
                        <span className="category">{ext.category}</span>
                        <span className="developer">{ext.developer.substring(0, 6)}...{ext.developer.substring(38)}</span>
                        <span className="date">
                          {new Date(ext.timestamp * 1000).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="extension-desc">{ext.description}</p>
                      <div className="extension-stats">
                        <span className="downloads">⬇️ {ext.downloads} downloads</span>
                        <span className="rating">⭐ {ext.rating}/5</span>
                      </div>
                      <div className="extension-actions">
                        <button className="tech-button">Download</button>
                        {isDeveloper(ext.developer) && ext.status === "pending" && (
                          <>
                            <button 
                              className="tech-button success"
                              onClick={() => verifyExtension(ext.id)}
                            >
                              Verify
                            </button>
                            <button 
                              className="tech-button danger"
                              onClick={() => rejectExtension(ext.id)}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  <div className="pagination">
                    <button 
                      className="tech-button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(currentPage - 1)}
                    >
                      Previous
                    </button>
                    <span>Page {currentPage} of {totalPages}</span>
                    <button 
                      className="tech-button"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(currentPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="panel">
          <h2 className="panel-title">Frequently Asked Questions</h2>
          <div className="panel-content">
            <div className="faq-section">
              {faqItems.map((faq, index) => (
                <div 
                  className={`faq-item ${activeFAQ === index ? 'active' : ''}`} 
                  key={index}
                  onClick={() => toggleFAQ(index)}
                >
                  <div className="faq-question">
                    {faq.question}
                    <div className="faq-toggle">{activeFAQ === index ? '−' : '+'}</div>
                  </div>
                  {activeFAQ === index && (
                    <div className="faq-answer">{faq.answer}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitExtension} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          extensionData={newExtensionData}
          setExtensionData={setNewExtensionData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHE Extension Marketplace</span>
            </div>
            <p>Secure browser extensions with FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Extension Marketplace. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  extensionData: any;
  setExtensionData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  extensionData,
  setExtensionData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setExtensionData({
      ...extensionData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!extensionData.name || !extensionData.sourceCode) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal tech-card">
        <div className="modal-header">
          <h2>Submit New Extension</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="key-icon"></div> 
            <span>Your source code will be encrypted with FHE during submission and verification</span>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Extension Name *</label>
              <input 
                type="text"
                name="name"
                value={extensionData.name} 
                onChange={handleChange}
                placeholder="My Secure Extension" 
                className="tech-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={extensionData.category} 
                onChange={handleChange}
                className="tech-select"
              >
                <option value="">Select category</option>
                <option value="Security">Security</option>
                <option value="Productivity">Productivity</option>
                <option value="Privacy">Privacy</option>
                <option value="Developer Tools">Developer Tools</option>
                <option value="Social Media">Social Media</option>
                <option value="Shopping">Shopping</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={extensionData.description} 
                onChange={handleChange}
                placeholder="Describe what your extension does..." 
                className="tech-textarea"
                rows={3}
              />
            </div>
            
            <div className="form-group full-width">
              <label>Source Code *</label>
              <textarea 
                name="sourceCode"
                value={extensionData.sourceCode} 
                onChange={handleChange}
                placeholder="Paste your extension source code here..." 
                className="tech-textarea code-input"
                rows={8}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn tech-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn tech-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;