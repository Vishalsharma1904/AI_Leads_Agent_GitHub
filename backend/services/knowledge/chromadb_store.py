import chromadb
from chromadb.config import Settings
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

class ChromaDBStore:
    def __init__(self, host: str = "localhost", port: int = 8000):
        try:
            self.client = chromadb.HttpClient(host=host, port=port)
            # We use the default embedding function (all-MiniLM-L6-v2) built into Chroma
            self.collection = self.client.get_or_create_collection(name="knowledge_base")
            logger.info("Connected to ChromaDB and initialized knowledge_base collection")
        except Exception as e:
            logger.error(f"Failed to connect to ChromaDB: {e}")
            self.client = None
            self.collection = None

    def add_documents(self, documents: List[str], metadatas: List[Dict[str, str]], ids: List[str]):
        if not self.collection:
            logger.error("ChromaDB collection not available")
            return
            
        try:
            self.collection.upsert(
                documents=documents,
                metadatas=metadatas,
                ids=ids
            )
            logger.info(f"Successfully added {len(documents)} documents to knowledge base")
        except Exception as e:
            logger.error(f"Failed to add documents to ChromaDB: {e}")

    def search(self, query: str, n_results: int = 3) -> List[str]:
        if not self.collection:
            return []
            
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=n_results
            )
            
            if results and 'documents' in results and len(results['documents']) > 0:
                # Return the list of document chunks
                return results['documents'][0]
            return []
        except Exception as e:
            logger.error(f"Failed to search ChromaDB: {e}")
            return []
